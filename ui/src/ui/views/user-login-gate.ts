import { html } from "lit";
import { t } from "../../i18n/index.ts";
import { renderThemeToggle } from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";

export function renderUserLoginGate(state: AppViewState) {
  return html`
    <div class="login-gate">
      <div class="login-gate__theme">${renderThemeToggle(state)}</div>
      <div class="login-gate__card">
        <div class="login-gate__header">
          <div class="login-gate__title">User Login</div>
          <div class="login-gate__sub">Enter your credentials to continue</div>
        </div>
        <div class="login-gate__form">
          <label class="field">
            <span>Email</span>
            <input
              type="email"
              autocomplete="off"
              .value=${state.email ?? ""}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                state.email = v;
              }}
              placeholder="admin@openclaw.local"
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  (state as any).loginWithCredentials?.();
                }
              }}
            />
          </label>
          <label class="field">
            <span>Password</span>
            <div class="login-gate__secret-row">
              <input
                type=${state.loginShowGatewayPassword ? "text" : "password"}
                autocomplete="off"
                spellcheck="false"
                .value=${state.password}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.password = v;
                }}
                placeholder="Password"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    (state as any).loginWithCredentials?.();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn--icon ${state.loginShowGatewayPassword ? "active" : ""}"
                title=${state.loginShowGatewayPassword ? "Hide password" : "Show password"}
                aria-label="Toggle password visibility"
                aria-pressed=${state.loginShowGatewayPassword}
                @click=${() => {
                  state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
                }}
              >
                ${state.loginShowGatewayPassword ? icons.eye : icons.eyeOff}
              </button>
            </div>
          </label>
          ${
            state.lastError
              ? html`<div class="callout danger" style="margin-bottom: 16px;">
                  <div>${state.lastError}</div>
                </div>`
              : ""
          }
          <button
            class="btn primary login-gate__connect"
            @click=${() => (state as any).loginWithCredentials?.()}
          >
            Login
          </button>
        </div>
      </div>
    </div>
  `;
}
