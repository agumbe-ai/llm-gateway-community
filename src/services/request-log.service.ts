import mongoose from "mongoose";

export type RequestLogRecord = {
  tenantId: string;
  userId: string;
  requestId: string;
  requestKind: "chat" | "embeddings";
  requestedModel: string;
  provider: string;
  upstreamModel: string;
  status: "success" | "error";
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errorCode?: string;
  createdAt: Date;
  requestPayload?: unknown;
  responsePayload?: unknown;
};

export type RequestLogListQuery = {
  tenantId: string;
  page: number;
  pageSize: number;
  status?: "success" | "error";
  requestKind?: "chat" | "embeddings";
  model?: string;
};

export type RequestLogListResult = {
  data: RequestLogRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type RequestLogDocument = mongoose.Document & RequestLogRecord;

const requestLogSchema = new mongoose.Schema<RequestLogDocument>(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    requestId: { type: String, required: true, index: true },
    requestKind: { type: String, enum: ["chat", "embeddings"], required: true },
    requestedModel: { type: String, required: true },
    provider: { type: String, required: true },
    upstreamModel: { type: String, required: true },
    status: { type: String, enum: ["success", "error"], required: true },
    latencyMs: { type: Number, required: true },
    promptTokens: { type: Number, required: true },
    completionTokens: { type: Number, required: true },
    totalTokens: { type: Number, required: true },
    estimatedCost: { type: Number, required: true },
    errorCode: { type: String },
    createdAt: { type: Date, required: true, default: Date.now },
    requestPayload: { type: mongoose.Schema.Types.Mixed },
    responsePayload: { type: mongoose.Schema.Types.Mixed },
  },
  {
    collection: "llm_requests",
    versionKey: false,
  },
);

requestLogSchema.index({ tenantId: 1, createdAt: -1 });

const RequestLogModel =
  (mongoose.models.LLMRequestLog as mongoose.Model<RequestLogDocument> | undefined) ||
  mongoose.model<RequestLogDocument>("LLMRequestLog", requestLogSchema);

export class RequestLogService {
  constructor(private readonly storePayloads: boolean) {}

  async log(record: RequestLogRecord): Promise<void> {
    const payload = this.storePayloads
      ? record
      : {
          ...record,
          requestPayload: undefined,
          responsePayload: undefined,
        };

    await RequestLogModel.create(payload);
  }

  async list(query: RequestLogListQuery): Promise<RequestLogListResult> {
    const filters: Record<string, unknown> = {
      tenantId: query.tenantId,
    };

    if (query.status) {
      filters.status = query.status;
    }

    if (query.requestKind) {
      filters.requestKind = query.requestKind;
    }

    if (query.model) {
      filters.requestedModel = {
        $regex: escapeRegex(query.model),
        $options: "i",
      };
    }

    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(10, query.pageSize));
    const skip = (page - 1) * pageSize;

    const [total, data] = await Promise.all([
      RequestLogModel.countDocuments(filters),
      RequestLogModel.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean<RequestLogRecord[]>(),
    ]);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
