import * as Sdk from "@reservoir0x/sdk";
import { BaseBuilder } from "@reservoir0x/sdk/dist/seaport/builders/base";

import { edb } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import * as utils from "@/orderbook/orders/seaport/build/utils";

interface BuildOrderOptions extends utils.BaseOrderBuildOptions {
  contract: string;
  tokenId: string;
}

export const build = async (options: BuildOrderOptions) => {
  // TODO: Include `NOT is_flagged` filter in the query
  const collectionResult = await edb.oneOrNone(
    `
      SELECT
        tokens.collection_id
      FROM tokens
      WHERE tokens.contract = $/contract/
        AND tokens.token_id = $/tokenId/
    `,
    {
      contract: toBuffer(options.contract),
      tokenId: options.tokenId,
    }
  );
  if (!collectionResult) {
    throw new Error("Could not retrieve token's collection");
  }

  const buildInfo = await utils.getBuildInfo(options, collectionResult.collection_id, "buy");
  if (!buildInfo) {
    throw new Error("Could not generate build info");
  }

  const builder: BaseBuilder = new Sdk.Seaport.Builders.SingleToken(config.chainId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (buildInfo.params as any).tokenId = options.tokenId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (buildInfo.params as any).amount = options.quantity;

  return builder?.build(buildInfo.params);
};
