import mongoose from "mongoose";
import { logger } from "../utils/logger";

mongoose.set("strictQuery", true);

export async function connectMongo(uri: string) {
  const connection = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  const db = connection.connection;
  db.on("error", (error) => {
    logger.error({ err: error }, "mongo error");
  });

  logger.info({ host: db.host, name: db.name }, "mongo connected");
  return db;
}

export async function closeMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

export function getMongoReadyState() {
  return mongoose.connection.readyState;
}
