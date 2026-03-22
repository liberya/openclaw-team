import { html, nothing } from "lit";
import { icons } from "../icons.ts";

export type ModelProvider = {
  id: string;
  name: string;
  baseUrl: string | null;
  api: string | null;
  auth: string | null;
  hasApiKey: boolean;
  hasModels: boolean;
  modelCount: number;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    input: Array<"text" | "image">;
    contextWindow: number;
    maxTokens: number;
  }>;
};

export type ProviderPreset = {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  auth: string;
  description: string;
};

export type ModelsProps = {
  loading: boolean;
  providers: ModelProvider[];
  presets: ProviderPreset[];
  error: string | null;
  isAdmin: boolean;
  showAddForm: boolean;
  editingProvider: ModelProvider | null;
  addingProvider: boolean;
  updatingProvider: boolean;
  manualInput: boolean;
  manualProviderId: string;
  viewingProvider: ModelProvider | null;
  onRefresh: () => void;
  onAddProvider: (providerId: string, apiKey: string, baseUrl: string) => void;
  onUpdateProvider: (providerId: string, apiKey: string) => void;
  onRemoveProvider: (providerId: string) => void;
  onToggleAddForm: () => void;
  onCancelEdit: () => void;
  onToggleEdit: (provider: ModelProvider) => void;
  onSaveManualModels: (providerId: string, modelIds: string[]) => void;
  onCancelManualInput: () => void;
  onViewModels: (provider: ModelProvider) => void;
  onCloseViewModels: () => void;
};

export function renderModels(props: ModelsProps) {
  if (!props.isAdmin) {
    return html`
      <div class="view-empty">
        <div class="view-empty-icon">${icons.lock}</div>
        <div class="view-empty-title">Access Denied</div>
        <div class="view-empty-text">You must be an administrator to access this page.</div>
      </div>
    `;
  }

  if (props.loading && props.providers.length === 0) {
    return html`
      <div class="view-loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading models...</div>
      </div>
    `;
  }

  if (props.error) {
    return html`
      <div class="view-error">
        <div class="view-error-icon">${icons.error}</div>
        <div class="view-error-title">Error Loading Models</div>
        <div class="view-error-text">${props.error}</div>
        <button class="btn btn-primary" @click=${props.onRefresh}>Retry</button>
      </div>
    `;
  }

  return html`
    <div class="models-view">
      <div class="models-header">
        <div class="models-title">
          <h2>Model Providers</h2>
          <span class="models-count">${props.providers.length} configured</span>
        </div>
        <button class="btn btn-primary" @click=${props.onToggleAddForm}>
          ${icons.add}
          <span>Add Provider</span>
        </button>
      </div>

      <div class="models-table-container">
        <table class="models-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>API</th>
              <th>Base URL</th>
              <th>API Key</th>
              <th>Models</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${props.providers.length === 0
              ? html`
                  <tr>
                    <td colspan="6" class="empty-row">
                      No model providers configured. Click "Add Provider" to add one.
                    </td>
                  </tr>
                `
              : props.providers.map(
                  (provider) => html`
                    <tr>
                      <td class="provider-name">
                        <strong>${provider.id}</strong>
                      </td>
                      <td>${provider.api ?? "-"}</td>
                      <td class="base-url">${provider.baseUrl ? html`<code>${provider.baseUrl}</code>` : "-"}</td>
                      <td>
                        ${provider.hasApiKey
                          ? html`<span class="badge badge-success">Configured</span>`
                          : html`<span class="badge badge-warning">Missing</span>`}
                      </td>
                      <td>
                        ${provider.hasModels
                          ? html`<span class="badge badge-info">${provider.modelCount} models</span>`
                          : html`<span class="badge badge-default">Auto</span>`}
                      </td>
                      <td class="actions">
                        <button
                          class="btn btn-sm btn-secondary"
                          title="View Models"
                          @click=${() => props.onViewModels(provider)}
                        >
                          ${icons.eye || html`&#128065;`}
                        </button>
                        <button
                          class="btn btn-sm btn-secondary"
                          title="Edit"
                          @click=${() => props.onToggleEdit(provider)}
                        >
                          ${icons.edit}
                        </button>
                        <button
                          class="btn btn-sm btn-danger"
                          title="Remove"
                          @click=${() => props.onRemoveProvider(provider.id)}
                        >
                          ${icons.trash}
                        </button>
                      </td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </div>

      ${props.showAddForm ? renderAddModal(props) : nothing}
      ${props.editingProvider ? renderEditModal(props) : nothing}
      ${props.viewingProvider ? renderViewModal(props) : nothing}
    </div>
  `;
}

function renderAddModal(props: ModelsProps) {
  if (props.manualInput) {
    return html`
      <div class="modal-overlay" @click=${(e: Event) => {
        if (e.target === e.currentTarget && !props.addingProvider) props.onCancelManualInput();
      }}>
        <div class="modal">
          <div class="modal-header">
            <h3>Add Models Manually</h3>
            ${!props.addingProvider ? html`<button class="modal-close" @click=${props.onCancelManualInput}>×</button>` : nothing}
          </div>
          <div class="modal-body">
            ${props.error ? html`<div style="color: #e53e3e; font-size: 13px; margin-bottom: 12px; padding: 8px; background: #fff5f5; border-radius: 4px; border: 1px solid #fc8181;">${props.error}</div>` : nothing}
            <div style="font-size: 13px; color: #666; margin-bottom: 12px;">
              Enter model IDs for <strong>${props.manualProviderId}</strong>, one per line:
            </div>
            <div class="form-group">
              <label for="manual-model-ids">Model IDs</label>
              <textarea
                id="manual-model-ids"
                class="form-control"
                rows="8"
                placeholder="e.g.&#10;qwen-plus&#10;qwen-turbo&#10;qwen-max&#10;qwen-vl-plus"
                ?disabled=${props.addingProvider}
              ></textarea>
              <small style="color: #888; font-size: 12px;">Enter one model ID per line. You can find model IDs from your provider's API documentation.</small>
            </div>
            ${props.addingProvider ? html`
              <div class="form-group">
                <div class="loading-spinner" style="margin: 10px auto;"></div>
                <p style="text-align: center; color: #666; font-size: 14px;">Saving models...</p>
              </div>
            ` : nothing}
          </div>
          <div class="modal-footer">
            ${!props.addingProvider ? html`
              <button class="btn btn-secondary" @click=${props.onCancelManualInput}>Cancel</button>
              <button class="btn btn-primary" @click=${() => {
                const textarea = document.getElementById("manual-model-ids") as HTMLTextAreaElement;
                if (!textarea?.value.trim()) {
                  alert("Please enter at least one model ID");
                  return;
                }
                const modelIds = textarea.value.split("\n").map(s => s.trim()).filter(Boolean);
                props.onSaveManualModels(props.manualProviderId, modelIds);
              }}>Save Models</button>
            ` : nothing}
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="modal-overlay" @click=${(e: Event) => {
      if (e.target === e.currentTarget && !props.addingProvider) props.onToggleAddForm();
    }}>
      <div class="modal">
        <div class="modal-header">
          <h3>Add Model Provider</h3>
          ${!props.addingProvider ? html`<button class="modal-close" @click=${props.onToggleAddForm}>×</button>` : nothing}
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="provider-select">Provider</label>
            <select id="provider-select" class="form-control" ?disabled=${props.addingProvider}>
              <option value="">-- Select a provider --</option>
              ${props.presets.map(
                (preset) => html`
                  <option value=${preset.id}>
                    ${preset.name} - ${preset.description}
                  </option>
                `
              )}
            </select>
          </div>
          <div class="form-group">
            <label for="api-key">API Key</label>
            <input
              type="password"
              id="api-key"
              class="form-control"
              placeholder="Enter API key"
              ?disabled=${props.addingProvider}
            />
          </div>
          <div class="form-group">
            <label for="base-url">Base URL (optional)</label>
            <input
              type="text"
              id="base-url"
              class="form-control"
              placeholder="Leave empty to use default"
              ?disabled=${props.addingProvider}
            />
          </div>
          ${props.addingProvider ? html`
            <div class="form-group">
              <div class="loading-spinner" style="margin: 10px auto;"></div>
              <p style="text-align: center; color: #666; font-size: 14px;">Discovering models...</p>
            </div>
          ` : nothing}
        </div>
        <div class="modal-footer">
          ${!props.addingProvider ? html`
            <button class="btn btn-secondary" @click=${props.onToggleAddForm}>Cancel</button>
            <button class="btn btn-primary" @click=${() => {
              const select = document.getElementById("provider-select") as HTMLSelectElement;
              const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
              const baseUrlInput = document.getElementById("base-url") as HTMLInputElement;
              if (select?.value && apiKeyInput?.value) {
                props.onAddProvider(select.value, apiKeyInput.value, baseUrlInput?.value || "");
              } else {
                alert("Please select a provider and enter API key");
              }
            }}>Add Provider</button>
          ` : nothing}
        </div>
      </div>
    </div>
  `;
}

function renderEditModal(props: ModelsProps) {
  const provider = props.editingProvider;
  if (!provider) return nothing;

  return html`
    <div class="modal-overlay" @click=${(e: Event) => {
      if (e.target === e.currentTarget && !props.updatingProvider) props.onCancelEdit();
    }}>
      <div class="modal">
        <div class="modal-header">
          <h3>Update ${provider.id}</h3>
          ${!props.updatingProvider ? html`<button class="modal-close" @click=${props.onCancelEdit}>×</button>` : nothing}
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="edit-api-key">New API Key</label>
            <input
              type="password"
              id="edit-api-key"
              class="form-control"
              placeholder="Enter new API key (leave empty to remove)"
              ?disabled=${props.updatingProvider}
            />
            <small style="color: #666; font-size: 12px;">Leave empty to keep existing API key. Changing the API key will trigger model discovery.</small>
          </div>
          ${props.updatingProvider ? html`
            <div class="form-group">
              <div class="loading-spinner" style="margin: 10px auto;"></div>
              <p style="text-align: center; color: #666; font-size: 14px;">Discovering models...</p>
            </div>
          ` : nothing}
        </div>
        <div class="modal-footer">
          ${!props.updatingProvider ? html`
            <button class="btn btn-secondary" @click=${props.onCancelEdit}>Cancel</button>
            <button class="btn btn-primary" @click=${() => {
              const apiKeyInput = document.getElementById("edit-api-key") as HTMLInputElement;
              props.onUpdateProvider(provider.id, apiKeyInput?.value || "");
            }}>Update</button>
          ` : nothing}
        </div>
      </div>
    </div>
  `;
}

function renderViewModal(props: ModelsProps) {
  const provider = props.viewingProvider;
  if (!provider) return nothing;

  return html`
    <div class="modal-overlay" @click=${(e: Event) => {
      if (e.target === e.currentTarget) props.onCloseViewModels();
    }}>
      <div class="modal" style="max-width: 700px;">
        <div class="modal-header">
          <h3>Models — ${provider.id}</h3>
          <button class="modal-close" @click=${props.onCloseViewModels}>×</button>
        </div>
        <div class="modal-body" style="padding: 12px 20px;">
          <div style="font-size: 13px; color: #666; margin-bottom: 12px;">
            <strong>Base URL:</strong> ${provider.baseUrl ?? "-"} &nbsp;|&nbsp;
            <strong>API:</strong> ${provider.api ?? "-"} &nbsp;|&nbsp;
            <strong>API Key:</strong> ${provider.hasApiKey ? html`<span class="badge badge-success">Configured</span>` : html`<span class="badge badge-warning">Missing</span>`}
          </div>
          ${provider.models.length === 0
            ? html`<p style="color: #888; font-size: 13px;">No models configured.</p>`
            : html`
              <div style="max-height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 1;">
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                      <th style="text-align: left; padding: 8px 12px; color: #475569;">Model ID</th>
                      <th style="text-align: center; padding: 8px 12px; color: #475569; width: 90px;">Reasoning</th>
                      <th style="text-align: center; padding: 8px 12px; color: #475569; width: 80px;">Image</th>
                      <th style="text-align: right; padding: 8px 12px; color: #475569; width: 100px;">Context Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${provider.models.map((model) => html`
                      <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 7px 12px; font-family: monospace; font-size: 12px; color: #334155;">${model.id}</td>
                        <td style="text-align: center; padding: 7px 12px;">
                          ${model.reasoning
                            ? html`<span style="color: #10b981; font-size: 16px;" title="Reasoning model">&#10003;</span>`
                            : html`<span style="color: #cbd5e1; font-size: 16px;">—</span>`}
                        </td>
                        <td style="text-align: center; padding: 7px 12px;">
                          ${model.input?.includes("image")
                            ? html`<span style="color: #8b5cf6; font-size: 16px;" title="Supports image input">&#10003;</span>`
                            : html`<span style="color: #cbd5e1; font-size: 16px;">—</span>`}
                        </td>
                        <td style="text-align: right; padding: 7px 12px; color: #64748b; font-size: 12px;">
                          ${model.contextWindow ? model.contextWindow.toLocaleString() : "-"}
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
              <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">
                ${provider.models.length} models total
              </div>
            `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click=${props.onCloseViewModels}>Close</button>
        </div>
      </div>
    </div>
  `;
}
