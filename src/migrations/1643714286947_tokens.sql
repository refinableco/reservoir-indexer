-- Up Migration
CREATE EXTENSION IF NOT EXISTS hstore;
CREATE TABLE "tokens" (
  "contract" BYTEA NOT NULL,
  "token_id" NUMERIC(78, 0) NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "image" TEXT,
  "media" TEXT,
  "collection_id" TEXT,
  "metadata_indexed" BOOLEAN,
  "attributes" HSTORE,
  "floor_sell_id" TEXT,
  "floor_sell_value" NUMERIC(78, 0),
  "floor_sell_maker" BYTEA,
  "floor_sell_valid_from" INT,
  "floor_sell_valid_to" INT,
  "floor_sell_source_id" BYTEA,
  "floor_sell_source_id_int" INT,
  "floor_sell_is_reservoir" BOOLEAN,
  "top_buy_id" TEXT,
  "top_buy_value" NUMERIC(78, 0),
  "top_buy_maker" BYTEA,
  "last_sell_timestamp" INT,
  "last_sell_value" NUMERIC(78, 0),
  "last_buy_timestamp" INT,
  "last_buy_value" NUMERIC(78, 0),
  "last_metadata_sync" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  "updated_at" TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE "tokens"
  ADD CONSTRAINT "tokens_pk"
  PRIMARY KEY ("contract", "token_id");

CREATE INDEX "tokens_contract_floor_sell_value_index"
  ON "tokens" ("contract", "floor_sell_value");

CREATE INDEX "tokens_collection_id_contract_token_id_index"
  ON "tokens" ("collection_id", "contract", "token_id");

CREATE INDEX "tokens_collection_id_source_id_floor_sell_value_index"
  ON "tokens" ("collection_id", "floor_sell_source_id", "floor_sell_value");

CREATE INDEX "tokens_collection_id_floor_sell_value_index"
  ON "tokens" ("collection_id", "floor_sell_value")
  WHERE ("floor_sell_is_reservoir");

CREATE INDEX "tokens_contract_top_buy_value_index"
  ON "tokens" ("contract", "top_buy_value" DESC NULLS LAST);

CREATE INDEX "tokens_collection_id_floor_sell_value_token_id_index"
  ON "tokens" ("collection_id", "floor_sell_value", "token_id");

CREATE INDEX "tokens_collection_id_top_buy_value_token_id_index"
  ON "tokens" ("collection_id", "top_buy_value" DESC NULLS LAST, "token_id" DESC);

CREATE INDEX "tokens_top_buy_maker_collection_id_index"
  ON "tokens" ("top_buy_maker", "collection_id")
  INCLUDE ("top_buy_value");

CREATE INDEX "tokens_contract_token_id_index"
  ON "tokens" ("contract", "token_id")
  INCLUDE ("floor_sell_value", "top_buy_value");

CREATE INDEX "tokens_updated_at_contract_token_id_index"
  ON "tokens" ("updated_at", "contract", "token_id");

-- https://www.lob.com/blog/supercharge-your-postgresql-performance
-- https://klotzandrew.com/blog/posgres-per-table-autovacuum-management
ALTER TABLE "tokens" SET (autovacuum_vacuum_scale_factor = 0.0);
ALTER TABLE "tokens" SET (autovacuum_vacuum_threshold = 5000);
ALTER TABLE "tokens" SET (autovacuum_analyze_scale_factor = 0.0);
ALTER TABLE "tokens" SET (autovacuum_analyze_threshold = 5000);

-- Down Migration

DROP TABLE "tokens";