/* eslint-disable @typescript-eslint/no-explicit-any */

import { defaultAbiCoder } from "@ethersproject/abi";
import { _TypedDataEncoder } from "@ethersproject/hash";
import { Wallet } from "@ethersproject/wallet";
import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { edb } from "@/common/db";
import { logger } from "@/common/logger";
import { bn, formatEth } from "@/common/utils";
import { config } from "@/config/index";

const version = "v1";

export const getCollectionFloorAskOracleV1Options: RouteOptions = {
  description: "Get a signed message of any collection's floor price (spot or twap)",
  tags: ["api", "oracle"],
  plugins: {
    "hapi-swagger": {
      order: 1,
    },
  },
  validate: {
    params: Joi.object({
      collection: Joi.string().lowercase().required(),
    }),
    query: Joi.object({
      contractName: Joi.string().required(),
      contractVersion: Joi.number().integer().positive().required(),
      verifyingContract: Joi.string()
        .lowercase()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required(),
      kind: Joi.string().valid("spot", "twap", "lower", "upper").default("spot"),
    }),
  },
  response: {
    schema: Joi.object({
      price: Joi.number().unsafe().required(),
      message: Joi.object({
        id: Joi.string().required(),
        payload: Joi.string().required(),
        timestamp: Joi.number().required(),
        signature: Joi.string().required(),
      }),
    }).label(`getCollectionFloorAskOracle${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(
        `get-collection-floor-ask-oracle-${version}-handler`,
        `Wrong response schema: ${error}`
      );
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;
    const params = request.params as any;

    try {
      const spotQuery = `
        SELECT
          collection_floor_sell_events.price
        FROM collection_floor_sell_events
        WHERE collection_floor_sell_events.collection_id = $/collection/
        ORDER BY collection_floor_sell_events.created_at DESC
        LIMIT 1
      `;

      const twapQuery = `
        WITH
          x AS (
            SELECT
              *
            FROM collection_floor_sell_events
            WHERE collection_floor_sell_events.collection_id = $/collection/
              AND collection_floor_sell_events.created_at >= now() - interval '24 hours'
            ORDER BY collection_floor_sell_events.created_at
          ),
          y AS (
            SELECT
              *
            FROM collection_floor_sell_events
            WHERE collection_floor_sell_events.collection_id = $/collection/
              AND collection_floor_sell_events.created_at < (SELECT MIN(x.created_at) FROM x)
            ORDER BY collection_floor_sell_events.created_at
            LIMIT 1
          ),
          z AS (
            SELECT * FROM x
            UNION ALL
            SELECT * FROM y
          ),
          w AS (
            SELECT
              price,
              floor(extract('epoch' FROM greatest(z.created_at, now() - interval '24 hours'))) AS start_time,
              floor(extract('epoch' FROM coalesce(lead(z.created_at, 1) OVER (ORDER BY created_at), now()))) AS end_time
            FROM z
          )
          SELECT
            SUM(
              w.price * (w.end_time - w.start_time)::NUMERIC) / ((MAX(w.end_time) - MIN(w.start_time))::NUMERIC
            ) AS price
          FROM w
      `;

      enum PriceKind {
        SPOT,
        TWAP,
        LOWER,
        UPPER,
      }

      let kind: PriceKind;
      let price: string;
      if (query.kind === "spot") {
        const result = await edb.oneOrNone(spotQuery, params);
        if (!result?.price) {
          throw Boom.badRequest("No floor ask price available");
        }

        kind = PriceKind.SPOT;
        price = result.price;
      } else if (query.kind === "twap") {
        const result = await edb.oneOrNone(twapQuery, params);
        if (!result?.price) {
          throw Boom.badRequest("No floor ask price available");
        }

        kind = PriceKind.TWAP;
        price = result.price;
      } else {
        const spotResult = await edb.oneOrNone(spotQuery, params);
        const twapResult = await edb.oneOrNone(twapQuery, params);
        if (!spotResult?.price || !twapResult?.price) {
          throw Boom.badRequest("No floor ask price available");
        }

        if (query.kind === "lower") {
          kind = PriceKind.LOWER;
          price = bn(spotResult.price).lt(twapResult.price) ? spotResult.price : twapResult.price;
        } else {
          kind = PriceKind.UPPER;
          price = bn(spotResult.price).gt(twapResult.price) ? spotResult.price : twapResult.price;
        }
      }

      // Use EIP-712 structured hashing (https://eips.ethereum.org/EIPS/eip-712)
      const EIP712_TYPES = {
        ContractWideCollectionPrice: {
          ContractWideCollectionPrice: [
            { name: "kind", type: "uint8" },
            { name: "contract", type: "address" },
          ],
        },
        TokenRangeCollectionPrice: {
          TokenRangeCollectionPrice: [
            { name: "kind", type: "uint8" },
            { name: "startTokenId", type: "uint256" },
            { name: "endTokenId", type: "uint256" },
          ],
        },
      };

      let id: string;
      if (params.collection.includes(":")) {
        const [contract, startTokenId, endTokenId] = params.collection.split(":");
        id = _TypedDataEncoder.hashStruct(
          "TokenRangeCollectionPrice",
          EIP712_TYPES.TokenRangeCollectionPrice,
          {
            kind,
            contract,
            startTokenId,
            endTokenId,
          }
        );
      } else {
        id = _TypedDataEncoder.hashStruct(
          "ContractWideCollectionPrice",
          EIP712_TYPES.ContractWideCollectionPrice,
          {
            kind,
            contract: params.collection,
          }
        );
      }

      const message: {
        id: string;
        payload: string;
        timestamp: number;
        signature?: string;
      } = {
        id,
        payload: defaultAbiCoder.encode(["uint256"], [price]),
        timestamp: Math.floor(Date.now() / 1000),
      };

      if (config.oraclePrivateKey) {
        const wallet = new Wallet(config.oraclePrivateKey);

        message.signature = await wallet._signTypedData(
          {
            name: query.contractName,
            version: String(query.contractVersion),
            // TODO: Potentially allow any chain id
            chainId: config.chainId,
            verifyingContract: query.verifyingContract,
          },
          {
            Message: [
              { name: "id", type: "bytes32" },
              { name: "payload", type: "bytes" },
              { name: "timestamp", type: "uint256" },
            ],
          },
          message
        );
      } else {
        throw Boom.badRequest("Instance cannot act as oracle");
      }

      return {
        price: formatEth(price),
        message,
      };
    } catch (error) {
      logger.error(
        `get-collection-floor-ask-oracle-${version}-handler`,
        `Handler failure: ${error}`
      );
      throw error;
    }
  },
};
