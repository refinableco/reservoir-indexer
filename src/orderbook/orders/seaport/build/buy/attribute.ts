import * as Sdk from "@reservoir0x/sdk";
import { BaseBuilder } from "@reservoir0x/sdk/dist/seaport/builders/base";

import { edb } from "@/common/db";
import { fromBuffer } from "@/common/utils";
import { config } from "@/config/index";
import * as utils from "@/orderbook/orders/seaport/build/utils";

interface BuildOrderOptions extends utils.BaseOrderBuildOptions {
  collection: string;
  attributes: { key: string; value: string }[];
}

export const build = async (options: BuildOrderOptions) => {
  if (options.attributes.length !== 1) {
    throw new Error("Attribute bids must be on a single attribute");
  }

  const attributeResult = await edb.oneOrNone(
    `
      SELECT
        collections.contract,
        attributes.token_count
      FROM attributes
      JOIN attribute_keys
        ON attributes.attribute_key_id = attribute_keys.id
      JOIN collections
        ON attribute_keys.collection_id = collections.id
      WHERE attribute_keys.collection_id = $/collection/
        AND attribute_keys.key = $/key/
        AND attributes.value = $/value/
    `,
    {
      collection: options.collection,
      key: options.attributes[0].key,
      value: options.attributes[0].value,
    }
  );
  if (!attributeResult) {
    throw new Error("Could not retrieve attribute info");
  }

  if (Number(attributeResult.token_count) > config.maxItemsPerBid) {
    throw new Error("Attribute has too many items");
  }

  const buildInfo = await utils.getBuildInfo(
    {
      ...options,
      contract: fromBuffer(attributeResult.contract),
    },
    options.collection,
    "buy"
  );
  if (!buildInfo) {
    throw new Error("Could not generate build info");
  }

  // Fetch all tokens matching the attributes
  // TODO: Include `NOT is_flagged` filter in the query
  const tokens = await edb.manyOrNone(
    `
      SELECT
        token_attributes.token_id
      FROM token_attributes
      JOIN attributes
        ON token_attributes.attribute_id = attributes.id
      JOIN attribute_keys
        ON attributes.attribute_key_id = attribute_keys.id
      WHERE attribute_keys.collection_id = $/collection/
        AND attribute_keys.key = $/key/
        AND attributes.value = $/value/
      ORDER BY token_attributes.token_id
    `,
    {
      collection: options.collection,
      key: options.attributes[0].key,
      value: options.attributes[0].value,
    }
  );

  const builder: BaseBuilder = new Sdk.Seaport.Builders.TokenList(config.chainId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (buildInfo.params as any).tokenIds = tokens.map(({ token_id }) => token_id);

  return builder?.build(buildInfo.params);
};
