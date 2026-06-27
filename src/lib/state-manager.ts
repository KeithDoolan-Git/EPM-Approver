import * as fs from "fs/promises";
import * as path from "path";
import { info, error, debug } from "./logger";

export interface RequestState {
  id: string;
  hash: string;
  notifiedAt: string;
  status: "pending" | "approved" | "denied";
}

export interface StateFile {
  lastPolled: string;
  requests: Record<string, RequestState>;
}

export class StateManager {
  private statePath: string;
  private state: StateFile;

  constructor(storagePath: string = "./state") {
    this.statePath = path.join(storagePath, "tracked-requests.json");
    this.state = {
      lastPolled: new Date().toISOString(),
      requests: {},
    };
  }

  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.statePath);
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (e) {
        // Directory might already exist
      }

      // Try to load existing state
      try {
        const content = await fs.readFile(this.statePath, "utf-8");
        this.state = JSON.parse(content);
        debug(`Loaded state from ${this.statePath}`);
      } catch (err) {
        // File doesn't exist yet, use defaults
        info("Creating new state file");
        await this.save();
      }
    } catch (err) {
      error("Failed to initialize state manager", undefined, err);
      throw err;
    }
  }

  async save(): Promise<void> {
    try {
      this.state.lastPolled = new Date().toISOString();
      await fs.writeFile(
        this.statePath,
        JSON.stringify(this.state, null, 2),
        "utf-8"
      );
      debug("State saved");
    } catch (err) {
      error("Failed to save state", undefined, err);
      throw err;
    }
  }

  isRequestNotified(requestId: string): boolean {
    return requestId in this.state.requests;
  }

  markRequestNotified(
    requestId: string,
    hash: string,
    status: string = "pending"
  ): void {
    this.state.requests[requestId] = {
      id: requestId,
      hash,
      notifiedAt: new Date().toISOString(),
      status: status as any,
    };
  }

  updateRequestStatus(requestId: string, status: string): void {
    if (requestId in this.state.requests) {
      this.state.requests[requestId].status = status as any;
    }
  }

  getTrackedRequestIds(): string[] {
    return Object.keys(this.state.requests);
  }

  clearOldEntries(daysToKeep: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    for (const [id, request] of Object.entries(this.state.requests)) {
      const notifiedDate = new Date(request.notifiedAt);
      if (notifiedDate < cutoffDate) {
        delete this.state.requests[id];
      }
    }

    debug("Cleaned up old state entries");
  }
}
