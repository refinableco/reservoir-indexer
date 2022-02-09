import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";
import { ApiKeyManager, ApiKeyRecord, NewApiKeyResponse } from '@/entities/apikeys/api-key';
import { logger } from '@/common/logger';

export const postApiKey: RouteOptions = {
  description:
    "Create a new API key",
  tags: ["api", "apikeys"],
  validate: {
    payload: Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
      website: Joi.string().uri().required()
    }),
  },
  response: {
    schema: Joi.object({
      key: Joi.string().required().uuid()
    }).label("getNewApiKeyResponse"),
    failAction: (_request, _h, error) => {
      throw error;
    },
  },
  handler: async (request: Request) => {
    const payload: any = request.payload
    const manager = new ApiKeyManager();

    const key: any = await manager.create(payload);
    if (!key) {
      throw new Error(`Unable to create a new api key with given values`);
    }

    return key;
  }
}
