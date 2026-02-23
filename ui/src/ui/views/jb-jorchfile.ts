import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { JorchfileProjectView, JorchfileView } from "../types.ts";

export type JorchfileProps = {
  loading: boolean;
  jorchfile: JorchfileView | null;
  error: string | null;
  dirty: boolean;
  textMode: boolean;
  rawContent: string;
  onRefresh: () => void;
  onSave: () => void;
  onToggleMode: () => void;
  onRawChange: (content: string) => void;
  onAddProject: () => void;
  onRemoveProject: (name: string) => void;
  onProjectFieldChange: (
    projectName: string,
    field: string,
    value: string | number | undefined,
  ) => void;
  onAddCommand: (projectName: string, cmdName: string, cmdValue: string) => void;
  onRemoveCommand: (projectName: string, cmdName: string) => void;
};

function renderProjectForm(project: JorchfileProjectView, props: JorchfileProps) {
  const commands = Object.entries(project.commands);

  return html`
    <details class="card" style="margin-bottom: 12px;" open>
      <summary style="cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 0;">
        <strong>${project.name}</strong>
        <span class="muted" style="font-size: 12px; margin-left: auto;">${project.path}</span>
      </summary>
      <div style="padding: 8px 0;">
        <div style="margin-bottom: 12px;">
          <label class="muted" style="display: block; font-size: 12px; margin-bottom: 4px;">${t("jorchfile.path")} <span style="color: var(--danger, #ef4444);">*</span></label>
          <input
            type="text"
            class="input"
            style="width: 100%;"
            .value=${project.path}
            @input=${(e: Event) => props.onProjectFieldChange(project.name, "path", (e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="row" style="gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 120px;">
            <label class="muted" style="display: block; font-size: 12px; margin-bottom: 4px;">${t("jorchfile.port")}</label>
            <input
              type="number"
              class="input"
              style="width: 100%;"
              min="1"
              max="65535"
              placeholder="${t("jorchfile.optional")}"
              .value=${project.port !== undefined ? String(project.port) : ""}
              @input=${(e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                const num = val ? Number.parseInt(val, 10) : undefined;
                if (num !== undefined && (num < 1 || num > 65535)) {
                  return;
                }
                props.onProjectFieldChange(project.name, "port", num);
              }}
            />
          </div>
          <div style="flex: 1; min-width: 120px;">
            <label class="muted" style="display: block; font-size: 12px; margin-bottom: 4px;">${t("jorchfile.approveMode")}</label>
            <select
              class="input"
              style="width: 100%;"
              @change=${(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                props.onProjectFieldChange(project.name, "approve", val || undefined);
              }}
            >
              <option value="" ?selected=${!project.approve}>${t("common.default")}</option>
              <option value="confirm" ?selected=${project.approve === "confirm"}>confirm</option>
              <option value="plan" ?selected=${project.approve === "plan"}>plan</option>
              <option value="auto" ?selected=${project.approve === "auto"}>auto</option>
            </select>
          </div>
          <div style="flex: 1; min-width: 120px;">
            <label class="muted" style="display: block; font-size: 12px; margin-bottom: 4px;">${t("jorchfile.output")}</label>
            <select
              class="input"
              style="width: 100%;"
              @change=${(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                props.onProjectFieldChange(project.name, "output", val || undefined);
              }}
            >
              <option value="" ?selected=${!project.output}>${t("common.default")}</option>
              <option value="verbose" ?selected=${project.output === "verbose"}>verbose</option>
              <option value="summary" ?selected=${project.output === "summary"}>summary</option>
              <option value="silent" ?selected=${project.output === "silent"}>silent</option>
            </select>
          </div>
        </div>

        ${
          project.tunnel !== undefined
            ? html`
            <div style="margin-bottom: 12px;">
              <label class="muted" style="display: block; font-size: 12px; margin-bottom: 4px;">${t("jorchfile.tunnel")}</label>
              <input
                type="text"
                class="input"
                style="width: 100%;"
                placeholder="${t("jorchfile.tunnelPlaceholder")}"
                .value=${project.tunnel ?? ""}
                @input=${(e: Event) => props.onProjectFieldChange(project.name, "tunnel", (e.target as HTMLInputElement).value)}
              />
            </div>
          `
            : nothing
        }

        <div style="margin-bottom: 12px;">
          <label class="muted" style="display: block; font-size: 12px; margin-bottom: 4px;">${t("jorchfile.instructions")}</label>
          <textarea
            class="input"
            style="width: 100%; min-height: 60px; resize: vertical; font-family: inherit;"
            placeholder="${t("jorchfile.instructionsPlaceholder")}"
            .value=${project.instructions ?? ""}
            @input=${(e: Event) => props.onProjectFieldChange(project.name, "instructions", (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div style="margin-bottom: 12px;">
          <div class="row" style="align-items: center; gap: 8px; margin-bottom: 8px;">
            <span class="muted" style="font-size: 12px;">${t("common.commands")}</span>
            <button
              class="btn btn--sm"
              @click=${() => {
                const name = prompt(t("jorchfile.commandName"));
                if (!name) {
                  return;
                }
                const command = prompt(t("jorchfile.shellCommand"));
                if (!command) {
                  return;
                }
                props.onAddCommand(project.name, name.trim(), command.trim());
              }}
            >${t("jorchfile.addCommand")}</button>
          </div>
          ${
            commands.length === 0
              ? html`
                  <span class="muted" style="font-size: 12px">${t("jorchfile.noCommands")}</span>
                `
              : commands.map(
                  ([cmdName, cmdValue]) => html`
                  <div class="row" style="gap: 8px; margin-bottom: 4px; align-items: center;">
                    <span class="pill" style="font-size: 11px; min-width: 60px;">${cmdName}</span>
                    <span class="mono" style="font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis;">${cmdValue}</span>
                    <button
                      class="btn btn--sm btn--danger"
                      @click=${() => props.onRemoveCommand(project.name, cmdName)}
                    >${t("common.remove")}</button>
                  </div>
                `,
                )
          }
        </div>

        <div style="border-top: 1px solid var(--border, #333); padding-top: 8px;">
          <button class="btn btn--sm btn--danger" @click=${() => props.onRemoveProject(project.name)}>
            ${t("jorchfile.removeProject")}
          </button>
        </div>
      </div>
    </details>
  `;
}

function renderFormMode(props: JorchfileProps) {
  const projects = props.jorchfile?.projects ?? [];

  return html`
    ${
      projects.length === 0
        ? html`
            <div class="muted" style="padding: 24px 0">
              ${t("jorchfile.noProjects")}
            </div>
          `
        : projects.map((project) => renderProjectForm(project, props))
    }
    <button class="btn" @click=${props.onAddProject} style="margin-top: 8px;">
      ${t("jorchfile.addProject")}
    </button>
  `;
}

function renderTextMode(props: JorchfileProps) {
  return html`
    <textarea
      class="input mono"
      style="width: 100%; min-height: 400px; resize: vertical; font-family: monospace; font-size: 13px; line-height: 1.5; tab-size: 2;"
      .value=${props.rawContent}
      @input=${(e: Event) => props.onRawChange((e.target as HTMLTextAreaElement).value)}
      spellcheck="false"
    ></textarea>
  `;
}

export function renderJorchfile(props: JorchfileProps) {
  return html`
    <section>
      <div class="row" style="margin-bottom: 16px; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("common.loading") : t("common.reload")}
        </button>
        <button
          class="btn"
          ?disabled=${!props.dirty}
          @click=${props.onSave}
        >${t("common.save")}</button>
        <button class="btn btn--sm jb-jorchfile-text-toggle" @click=${props.onToggleMode}>
          ${props.textMode ? t("common.form") : t("common.text")}
        </button>
        ${
          props.dirty
            ? html`
                <span class="pill" style="font-size: 11px; background: var(--warn, #f59e0b); color: #000"
                  >${t("jorchfile.unsavedChanges")}</span
                >
              `
            : nothing
        }
      </div>
      ${props.error ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.error}</div>` : nothing}
      ${
        props.jorchfile === null && !props.loading
          ? html`
              <div class="muted" style="padding: 24px 0">
                ${t("jorchfile.noJorchfile")}
              </div>
            `
          : nothing
      }
      ${props.textMode ? renderTextMode(props) : renderFormMode(props)}
    </section>
  `;
}
