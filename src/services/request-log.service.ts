import mongoose from "mongoose";

export type RequestLogRecord = {
  tenantId: string;
  userId: string;
  subjectType?: "session" | "app";
  appId?: string;
  workspaceId?: string;
  xnamespaceId?: string;
  sourceService?: string;
  operation?: string;
  externalRequestId?: string;
  requestId: string;
  requestKind: "chat" | "embeddings" | "responses";
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
  requestKind?: "chat" | "embeddings" | "responses";
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
    subjectType: { type: String, enum: ["session", "app"] },
    appId: { type: String, index: true },
    workspaceId: { type: String, index: true },
    xnamespaceId: { type: String, index: true },
    sourceService: { type: String, index: true },
    operation: { type: String, index: true },
    externalRequestId: { type: String, index: true },
    requestKind: { type: String, enum: ["chat", "embeddings", "responses"], required: true },
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
  private readonly memoryStore: RequestLogRecord[] = [];

  constructor(
    private readonly storePayloads: boolean,
    private readonly persistenceEnabled = true,
  ) {}

  async log(record: RequestLogRecord): Promise<void> {
    const payload = this.storePayloads
      ? record
      : {
          ...record,
          requestPayload: undefined,
          responsePayload: undefined,
        };

    if (!this.persistenceEnabled) {
      this.memoryStore.unshift(payload);
      this.memoryStore.splice(500);
      return;
    }

    await RequestLogModel.create(payload);
  }

  async list(query: RequestLogListQuery): Promise<RequestLogListResult> {
    if (!this.persistenceEnabled) {
      const filtered = this.memoryStore.filter((record) => {
        if (record.tenantId !== query.tenantId) return false;
        if (query.status && record.status !== query.status) return false;
        if (query.requestKind && record.requestKind !== query.requestKind) return false;
        if (
          query.model &&
          !record.requestedModel.toLowerCase().includes(query.model.toLowerCase())
        ) {
          return false;
        }
        return true;
      });

      const page = Math.max(1, query.page);
      const pageSize = Math.min(100, Math.max(10, query.pageSize));
      const start = (page - 1) * pageSize;
      const data = filtered.slice(start, start + pageSize);

      return {
        data,
        pagination: {
          page,
          pageSize,
          total: filtered.length,
          totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
        },
      };
    }

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
