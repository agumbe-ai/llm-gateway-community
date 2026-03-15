import { Producer, type ProducerGlobalConfig } from "node-rdkafka";
import type { Env } from "../config/env";
import { logger } from "../utils/logger";

export class KafkaService {
  private producer?: Producer;
  private connectPromise?: Promise<Producer>;

  constructor(private readonly env: Env) {}

  async connect(): Promise<void> {
    if (!this.env.KAFKA_ENABLED) {
      logger.info("kafka disabled");
      return;
    }

    await this.getProducer();
  }

  async produce(topic: string, key: string, payload: unknown): Promise<void> {
    if (!this.env.KAFKA_ENABLED) {
      return;
    }

    const producer = await this.getProducer();
    const valueBuffer = Buffer.from(JSON.stringify(payload));
    const keyBuffer = Buffer.from(key);

    producer.produce(topic, -1, valueBuffer, keyBuffer, Date.now());
  }

  close() {
    this.producer?.disconnect();
  }

  private async getProducer(): Promise<Producer> {
    if (this.producer) {
      return this.producer;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const config = {
      "bootstrap.servers": this.env.KAFKA_BROKERS.join(","),
      "client.id": this.env.KAFKA_CLIENT_ID,
      "message.timeout.ms": this.env.KAFKA_TIMEOUT_MS,
    } as ProducerGlobalConfig & Record<string, unknown>;

    if (this.env.KAFKA_PROTOCOL) {
      config["security.protocol"] = this.env.KAFKA_PROTOCOL as
        | "plaintext"
        | "ssl"
        | "sasl_plaintext"
        | "sasl_ssl";
    }

    if (this.env.KAFKA_MECHANISMS) {
      config["sasl.mechanisms"] = this.env.KAFKA_MECHANISMS;
    }

    if (this.env.KAFKA_USERNAME) {
      config["sasl.username"] = this.env.KAFKA_USERNAME;
    }

    if (this.env.KAFKA_PASSWORD) {
      config["sasl.password"] = this.env.KAFKA_PASSWORD;
    }

    const producer = new Producer(config);
    this.producer = producer;

    producer.on("event.error", (error) => {
      logger.error({ err: error }, "kafka producer error");
    });

    this.connectPromise = new Promise<Producer>((resolve, reject) => {
      producer.once("ready", () => {
        logger.info("kafka producer ready");
        resolve(producer);
      });

      producer.once("event.error", (error) => {
        reject(error);
      });

      producer.connect();
    });

    return this.connectPromise;
  }
}
