import { Job, Queue, QueueScheduler, Worker } from "bullmq";
import { redis } from "@/common/redis";
import { config } from "@/config/index";
import { logger } from "@/common/logger";
import { Attributes } from "@/models/attributes";
import { Tokens } from "@/models/tokens";

const QUEUE_NAME = "resync-attribute-cache-queue";

export const queue = new Queue(QUEUE_NAME, {
  connection: redis.duplicate(),
  defaultJobOptions: {
    attempts: 10,
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

new QueueScheduler(QUEUE_NAME, { connection: redis.duplicate() });

if (config.doBackgroundWork) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { contract, tokenId } = job.data;
      const tokenAttributes = await Tokens.getTokenAttributes(contract, tokenId);

      // Recalculate the number of tokens on sale for each attribute
      for (const tokenAttribute of tokenAttributes) {
        const { floorSellValue, onSaleCount } = await Tokens.getSellFloorValueAndOnSaleCount(
          tokenAttribute.collectionId,
          tokenAttribute.key,
          tokenAttribute.value
        );

        await Attributes.update(tokenAttribute.attributeId, {
          floorSellValue,
          onSaleCount,
          sellUpdatedAt: new Date().toISOString(),
        });

        logger.info(
          QUEUE_NAME,
          `collection=${tokenAttribute.collectionId}, key=${tokenAttribute.key}, value=${tokenAttribute.value}, floorSellValue=${floorSellValue}, onSaleCount=${onSaleCount}`
        );
      }
    },
    {
      connection: redis.duplicate(),
      concurrency: 3,
    }
  );

  worker.on("error", (error) => {
    logger.error(QUEUE_NAME, `Worker errored: ${error}`);
  });
}

export const addToQueue = async (contract: string, tokenId: string, delay = 60 * 60 * 1000) => {
  const token = `${contract}:${tokenId}`;
  await queue.add(token, { contract, tokenId }, { jobId: token, delay });
};
