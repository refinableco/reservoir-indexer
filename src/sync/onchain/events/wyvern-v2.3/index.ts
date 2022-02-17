import { Interface } from "@ethersproject/abi";
import { Log } from "@ethersproject/abstract-provider";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import {
  CancelEvent,
  addCancelEvents,
  removeCancelEvents,
} from "@/events/common/cancels";
import {
  FillEvent,
  addFillEvents,
  removeFillEvents,
} from "@/events/common/fills";
import { ContractInfo } from "@/events/index";
import { parseEvent } from "@/events/parser";
import { FillInfo, addToFillsHandleQueue } from "@/jobs/fills-handle";
import { HashInfo, addToOrdersUpdateByHashQueue } from "@/jobs/orders-update";
import { db } from "@/common/db";

const abi = new Interface([
  `event OrderCancelled(
    bytes32 indexed hash
  )`,
  `event OrdersMatched(
    bytes32 buyHash,
    bytes32 sellHash,
    address indexed maker,
    address indexed taker,
    uint256 price,
    bytes32 indexed metadata
  )`,
  `event NonceIncremented(
    address indexed maker,
    uint256 newNonce
  )`,
]);

type BulkCancelEvent = {
  context: string;
  maker: string;
  newNonce: string;
};

export const getContractInfo = (address: string[] = []): ContractInfo => ({
  filter: { address },
  syncCallback: async (logs: Log[], backfill?: boolean) => {
    const bulkCancelEvents: BulkCancelEvent[] = [];
    const cancelEvents: CancelEvent[] = [];
    const fillEvents: FillEvent[] = [];
    const hashInfos: HashInfo[] = [];
    const fillInfos: FillInfo[] = [];

    for (const log of logs) {
      try {
        const baseParams = parseEvent(log);
        const context =
          baseParams.txHash + "-" + baseParams.logIndex.toString();

        switch (log.topics[0]) {
          case abi.getEventTopic("OrderCancelled"): {
            const parsedLog = abi.parseLog(log);
            const orderHash = parsedLog.args.hash.toLowerCase();

            cancelEvents.push({
              orderHash,
              baseParams,
            });

            hashInfos.push({ context, hash: orderHash });

            break;
          }

          case abi.getEventTopic("OrdersMatched"): {
            const parsedLog = abi.parseLog(log);
            const buyHash = parsedLog.args.buyHash.toLowerCase();
            const sellHash = parsedLog.args.sellHash.toLowerCase();
            const maker = parsedLog.args.maker.toLowerCase();
            const taker = parsedLog.args.taker.toLowerCase();
            const price = parsedLog.args.price.toString();

            fillEvents.push({
              buyHash,
              sellHash,
              maker,
              taker,
              price,
              baseParams,
            });

            hashInfos.push({ context, hash: buyHash });
            hashInfos.push({ context, hash: sellHash });
            fillInfos.push({
              context,
              buyHash,
              sellHash,
              block: baseParams.block,
            });

            break;
          }

          case abi.getEventTopic("NonceIncremented"): {
            const parsedLog = abi.parseLog(log);
            const maker = parsedLog.args.maker.toLowerCase();
            const newNonce = parsedLog.args.newNonce.toString();

            bulkCancelEvents.push({ context, maker, newNonce });

            break;
          }
        }
      } catch (error) {
        logger.error(
          "wyvern_v2_callback",
          `Could not parse log ${log}: ${error}`
        );
      }
    }

    await addCancelEvents("wyvern-v2", cancelEvents);
    await addFillEvents("wyvern-v2", fillEvents);

    if (!backfill) {
      if (config.acceptOrders) {
        await addToOrdersUpdateByHashQueue(hashInfos);
        await addToFillsHandleQueue(fillInfos);

        for (const { context, maker, newNonce } of bulkCancelEvents) {
          // TODO: Use multi-row inserts
          const hashes: { hash: string }[] = await db.manyOrNone(
            `
              update "orders" set "status" = 'cancelled'
              where "kind" = 'wyvern-v2.3'
                and "maker" = $/maker/
                and "nonce" < $/nonce/
                and ("status" = 'valid' or "status" = 'no-balance')
              return "hash"
            `,
            {
              maker,
              nonce: newNonce,
            }
          );

          await addToOrdersUpdateByHashQueue(
            hashes.map(({ hash }) => ({ context, hash }))
          );
        }
      }
    }
  },
  fixCallback: async (blockHash) => {
    await removeCancelEvents(blockHash);
    await removeFillEvents(blockHash);
  },
});
