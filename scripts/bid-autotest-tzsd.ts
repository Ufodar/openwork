#!/usr/bin/env bun
/**
 * Minimal, end-to-end module smoke test for the bid MVP using the user's tzsd dataset.
 *
 * What this validates (without the UI):
 * - Large inbox uploads (fixes 413 regressions)
 * - Session-scoped reference library layout under `.opencode/openwork/inbox/sessions/<sessionId>/refs/...`
 * - OnlyOffice document upload target under `documents/sessions/<sessionId>/...`
 * - Section copy endpoints (tender/partner -> target template)
 * - Deterministic rendering to PDF/PNG for visual inspection
 *
 * Usage:
 *   bun scripts/bid-autotest-tzsd.ts
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

type DevHeadlessWebState = {
  openworkPort?: number;
  openworkToken?: string;
};

type WorkspaceListResponse = {
  items?: Array<{ id: string }>;
  activeId?: string;
};

const cwd = process.cwd();

const DEFAULT_DATASET_ROOT =
  "/Users/storm/Pictures/untitled folder/标书文件/智能员工资料/tzsd项目伙伴";
const DEFAULT_TEMPLATE_PATH = "/Users/storm/Pictures/主标空模版.docx";

type AutotestPreset = "forms" | "full";

const readDevState = async (): Promise<DevHeadlessWebState | null> => {
  const statePath = join(cwd, "tmp", "dev-headless-web.state.json");
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw) as DevHeadlessWebState;
  } catch {
    return null;
  }
};

const resolveServer = async () => {
  const state = await readDevState();
  const port = Number(state?.openworkPort);
  const token = String(state?.openworkToken ?? "").trim();
  if (!Number.isFinite(port) || port <= 0 || !token) {
    throw new Error(
      "Missing OpenWork dev state (tmp/dev-headless-web.state.json). Start dev stack first: `pnpm dev:headless-web`.",
    );
  }
  return { baseUrl: `http://127.0.0.1:${port}`, token };
};

const fetchJson = async (url: string, token: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed (${response.status})`);
  }
  return await response.json();
};

const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

const uploadInbox = async (input: {
  baseUrl: string;
  token: string;
  workspaceId: string;
  localPath: string;
  destPath: string;
}) => {
  const url = new URL(`/workspace/${encodeURIComponent(input.workspaceId)}/inbox`, input.baseUrl);
  url.searchParams.set("path", input.destPath);
  const formData = new FormData();
  formData.append("file", Bun.file(input.localPath));
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}` },
    body: formData,
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(text || `Inbox upload failed (${response.status})`);
  }
  return { ok: true, inboxId: base64url(input.destPath), destPath: input.destPath };
};

const uploadDocument = async (input: {
  baseUrl: string;
  token: string;
  workspaceId: string;
  sessionId: string;
  localPath: string;
}) => {
  const url = new URL(`/w/${encodeURIComponent(input.workspaceId)}/document/upload`, input.baseUrl);
  url.searchParams.set("session", input.sessionId);
  const formData = new FormData();
  formData.append("file", Bun.file(input.localPath));
  const data = (await fetchJson(url.toString(), input.token, { method: "POST", body: formData })) as { name?: string };
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  if (!name) {
    throw new Error("Document upload returned no name");
  }
  return { name };
};

const copySection = async (input: {
  baseUrl: string;
  token: string;
  workspaceId: string;
  sessionId: string;
  targetDoc: string;
  sourceInboxId: string;
  sourceHeading: string;
  sourceHeadingIndex?: number;
  targetHeading?: string;
  targetHeadingIndex?: number;
  excludeSourceHeading?: boolean;
}) => {
  const url = new URL(`/w/${encodeURIComponent(input.workspaceId)}/document/copy-section`, input.baseUrl);
  url.searchParams.set("session", input.sessionId);
  url.searchParams.set("doc", input.targetDoc);
  const payload: Record<string, unknown> = {
    sourceInboxId: input.sourceInboxId,
    sourceHeading: input.sourceHeading,
    matchMode: "exact",
    excludeSourceHeading: Boolean(input.excludeSourceHeading),
  };
  if (input.sourceHeadingIndex) payload.sourceHeadingIndex = input.sourceHeadingIndex;
  if (input.targetHeading) payload.targetHeading = input.targetHeading;
  if (input.targetHeadingIndex) payload.targetHeadingIndex = input.targetHeadingIndex;
  return await fetchJson(url.toString(), input.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

const run = async () => {
  const { baseUrl, token } = await resolveServer();
  const workspaces = (await fetchJson(`${baseUrl}/workspaces`, token)) as WorkspaceListResponse;
  const workspaceId = workspaces.activeId ?? workspaces.items?.[0]?.id;
  if (!workspaceId) throw new Error("Unable to resolve workspaceId from /workspaces");

  const preset = (process.env.BID_AUTOTEST_PRESET ?? "forms").trim().toLowerCase() as AutotestPreset;
  if (preset !== "forms" && preset !== "full") {
    throw new Error(`Unsupported BID_AUTOTEST_PRESET: ${preset} (expected 'forms' or 'full')`);
  }

  const sessionId = `ses_autotest_tzsd_${Date.now().toString(36)}`;
  const datasetRoot = DEFAULT_DATASET_ROOT;
  const templatePath = DEFAULT_TEMPLATE_PATH;

  const paths = {
    tenderDoc: join(datasetRoot, "招标文件1000万无线网络升级改造A326招标文件（政）最终版.doc"),
    partnerDoc: join(datasetRoot, "项目伙伴文档", "天职师大无线网升级项目合并版本10.31_伙伴3.doc"),
    techXlsx: join(datasetRoot, "产品信息", "新华三", "新华三", "技术应答表-新华三.xlsx"),
    equipXlsx: join(datasetRoot, "产品信息", "新华三", "新华三", "天津职业技术师范大学网络+智算项目清单-新华三.xlsx"),
    brandDeviationXls: join(datasetRoot, "产品信息", "天职师大项目伙伴3技术偏离表_品牌.xls"),
  };

  const outDir = join(cwd, "tmp", "bid-autotest", sessionId);
  await mkdir(outDir, { recursive: true });

  const report: string[] = [];
  report.push(`# Bid autotest (tzsd)\n`);
  report.push(`- Session: \`${sessionId}\``);
  report.push(`- OpenWork: \`${baseUrl}\``);
  report.push(`- Workspace: \`${workspaceId}\``);
  report.push(`- Preset: \`${preset}\``);
  report.push("");

  report.push("## Upload target document");
  const uploadedDoc = await uploadDocument({
    baseUrl,
    token,
    workspaceId,
    sessionId,
    localPath: templatePath,
  });
  report.push(`- Target doc: \`${uploadedDoc.name}\``);
  report.push("");

  report.push("## Upload reference materials (session-scoped inbox)");
  const uploads: Array<{ label: string; local: string; dest: string; inboxId: string }> = [];
  const pushUpload = async (label: string, localPath: string, category: string) => {
    const dest = `sessions/${sessionId}/refs/${category}/${basename(localPath)}`;
    const result = await uploadInbox({ baseUrl, token, workspaceId, localPath, destPath: dest });
    uploads.push({ label, local: localPath, dest, inboxId: result.inboxId });
    report.push(`- ${label}: \`${dest}\``);
    return result;
  };

  await pushUpload("Tender (source of truth)", paths.tenderDoc, "tender");
  await pushUpload("Partner bid (reference)", paths.partnerDoc, "partners");
  await pushUpload("Tech responses (xlsx)", paths.techXlsx, "technical");
  await pushUpload("Equipment list (xlsx)", paths.equipXlsx, "technical");
  await pushUpload("Brand deviation (xls)", paths.brandDeviationXls, "technical");
  report.push("");

  report.push("## Assemble (copy sections into target)");
  const tenderUpload = uploads.find((u) => u.label.startsWith("Tender"));
  const partnerUpload = uploads.find((u) => u.label.startsWith("Partner"));
  if (!tenderUpload || !partnerUpload) throw new Error("Missing tender/partner uploads");

  const copySteps: Array<{ label: string; result: unknown }> = [];

  // Tender: deadlines / open time & place
  copySteps.push({
    label: "Tender -> 截止/开标时间地点",
    result: await copySection({
      baseUrl,
      token,
      workspaceId,
      sessionId,
      targetDoc: uploadedDoc.name,
      sourceInboxId: tenderUpload.inboxId,
      sourceHeading: "四、提交投标文件截止时间、开标时间和地点",
      excludeSourceHeading: false,
    }),
  });

  // Partner: formatted bid opening table
  copySteps.push({
    label: "Partner -> 开标一览表",
    result: await copySection({
      baseUrl,
      token,
      workspaceId,
      sessionId,
      targetDoc: uploadedDoc.name,
      sourceInboxId: partnerUpload.inboxId,
      sourceHeading: "开标一览表",
      excludeSourceHeading: false,
    }),
  });

  // Partner: common submission forms / technical response tables
  for (const heading of ["开标分项一览表", "投标产品点对点应答表", "投标产品配置清单", "售后服务承诺"] as const) {
    copySteps.push({
      label: `Partner -> ${heading}`,
      result: await copySection({
        baseUrl,
        token,
        workspaceId,
        sessionId,
        targetDoc: uploadedDoc.name,
        sourceInboxId: partnerUpload.inboxId,
        sourceHeading: heading,
        excludeSourceHeading: false,
      }),
    });
  }

  if (preset === "full") {
    for (const heading of [
      "投标人资质证明文件",
      "法定代表人授权书",
      "法定代表人身份证明书",
      "无重大违法记录声明",
      "中小企业声明函",
      "投标人主要业绩表",
      "主要技术内容",
    ] as const) {
      copySteps.push({
        label: `Partner -> ${heading}`,
        result: await copySection({
          baseUrl,
          token,
          workspaceId,
          sessionId,
          targetDoc: uploadedDoc.name,
          sourceInboxId: partnerUpload.inboxId,
          sourceHeading: heading,
          excludeSourceHeading: false,
        }),
      });
    }
  }

  for (const step of copySteps) {
    report.push(`- ${step.label}: ok`);
  }
  report.push("");

  const targetDocAbs = resolve(join(cwd, "documents", "sessions", sessionId, uploadedDoc.name));

  report.push("## Fill bid tables (xlsx -> docx)");
  const inboxRoot = resolve(join(cwd, ".opencode", "openwork", "inbox"));
  const techInboxPath = resolve(join(inboxRoot, `sessions/${sessionId}/refs/technical/${basename(paths.techXlsx)}`));
  const equipInboxPath = resolve(join(inboxRoot, `sessions/${sessionId}/refs/technical/${basename(paths.equipXlsx)}`));
  const fillScript = resolve(join(cwd, ".opencode", "skills", "bid-drafting", "scripts", "fill_bid_tables_mvp.py"));
  const fill = spawnSync(
    "python3",
    [
      fillScript,
      "--docx",
      targetDocAbs,
      "--tech-xlsx",
      techInboxPath,
      "--equip-xlsx",
      equipInboxPath,
      "--brand",
      "新华三",
      "--manufacturer",
      "新华三技术有限公司",
      "--origin",
      "中国",
      "--unit",
      "台",
      "--price-placeholder",
      "详见报价文件",
      "--spec-placeholder",
      "详见开标分项一览表",
    ],
    { encoding: "utf8" },
  );
  if (fill.status !== 0) {
    throw new Error(`fill_bid_tables_mvp.py failed: ${String(fill.stderr || fill.stdout || "").trim() || "unknown"}`);
  }
  report.push("```");
  report.push(String(fill.stdout || "").trim());
  report.push("```");
  report.push("");

  report.push("## QC gate (deterministic checks)");
  const qcScript = resolve(join(cwd, ".opencode", "skills", "bid-drafting", "scripts", "qc_bid_mvp.py"));
  const qc = spawnSync("python3", [qcScript, "--docx", targetDocAbs], { encoding: "utf8" });
  report.push(`- Status: ${qc.status === 0 ? "PASS" : "FAIL"}`);
  report.push("```");
  report.push(String(qc.stdout || qc.stderr || "").trim());
  report.push("```");
  report.push("");

  report.push("## Output");
  report.push(`- DOCX: \`${targetDocAbs}\``);

  // Render to PDF and PNG for quick visual verification.
  const renderDir = join(outDir, "render");
  await mkdir(renderDir, { recursive: true });
  const soffice = spawnSync(
    "soffice",
    ["--headless", "--nologo", "--nofirststartwizard", "--convert-to", "pdf", "--outdir", renderDir, targetDocAbs],
    { encoding: "utf8" },
  );
  if (soffice.status !== 0) {
    throw new Error(
      `LibreOffice PDF export failed: ${String(soffice.stderr || soffice.stdout || "").trim() || "unknown"}`,
    );
  }
  const pdfPath = join(renderDir, `${basename(uploadedDoc.name, ".docx")}.pdf`);
  report.push(`- PDF: \`${pdfPath}\``);

  const pngPrefix = join(renderDir, "pages");
  const pdftoppm = spawnSync("pdftoppm", ["-png", "-f", "1", "-l", "3", pdfPath, pngPrefix], { encoding: "utf8" });
  if (pdftoppm.status !== 0) {
    throw new Error(
      `pdftoppm failed: ${String(pdftoppm.stderr || pdftoppm.stdout || "").trim() || "unknown"}`,
    );
  }
  const pngFiles = (await readdir(renderDir)).filter((name) => name.startsWith("pages-") && name.endsWith(".png")).sort();
  if (pngFiles.length) {
    report.push(`- PNG (preview): ${pngFiles.map((name) => `\`${join(renderDir, name)}\``).join(", ")}`);
  } else {
    report.push(`- PNG (preview): (none produced)`);
  }
  report.push("");

  const reportPath = join(outDir, "report.md");
  await writeFile(reportPath, `${report.join("\n")}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
};

await run();
