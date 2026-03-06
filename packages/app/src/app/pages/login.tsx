import { Show, createSignal } from "solid-js";

import Button from "../components/button";
import TextInput from "../components/text-input";
import type { OpenworkServerStatus } from "../lib/openwork-server";

export type LoginViewProps = {
  serverUrl: string;
  serverStatus: OpenworkServerStatus;
  onAuthenticate: (
    mode: "register" | "login",
    input: { username: string; password: string },
  ) => Promise<void>;
};

export default function LoginView(props: LoginViewProps) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal<"idle" | "register" | "login">("idle");
  const [message, setMessage] = createSignal<string | null>(null);
  const [messageTone, setMessageTone] = createSignal<"idle" | "ok" | "error">("idle");

  const statusLabel = () => {
    switch (props.serverStatus) {
      case "connected":
        return "已连接";
      case "limited":
        return "需要认证";
      default:
        return "未连接";
    }
  };

  const runAuth = async (mode: "register" | "login") => {
    if (busy() !== "idle") return;
    const nextUsername = username().trim();
    const nextPassword = password();
    if (!nextUsername || !nextPassword) {
      setMessageTone("error");
      setMessage("请输入用户名和密码。");
      return;
    }

    setBusy(mode);
    setMessage(null);
    setMessageTone("idle");
    try {
      await props.onAuthenticate(mode, {
        username: nextUsername,
        password: nextPassword,
      });
      setMessageTone("ok");
      setMessage(mode === "register" ? "注册成功。" : "登录成功。");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "认证失败。";
      const normalized = raw.toLowerCase();
      let friendly = raw;
      if (normalized.includes("3-32 chars")) friendly = "用户名格式不正确，请重新输入。";
      else if (normalized.includes("at least 6 characters")) friendly = "密码长度不正确，请重新输入。";
      else if (normalized.includes("username is required")) friendly = "用户名不能为空。";
      else if (normalized.includes("password is required")) friendly = "密码不能为空。";
      else if (normalized.includes("username must be 64")) friendly = "用户名长度不能超过 64 个字符。";
      else if (normalized.includes("registration failed")) friendly = "注册失败。";
      else if (normalized.includes("login failed")) friendly = "登录失败。";
      else if (normalized.includes("already exists")) friendly = "用户名已存在，请更换。";
      else if (normalized.includes("invalid username or password")) friendly = "用户名或密码错误。";
      setMessageTone("error");
      setMessage(friendly);
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-1 p-6">
      <div class="w-full max-w-md rounded-2xl border border-gray-6 bg-gray-2/40 p-6 space-y-5 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
        <div>
          <div class="text-lg font-semibold text-gray-12">登录</div>
          <div class="text-xs text-gray-10">先注册，账号不重复即可。</div>
        </div>

        <div class="rounded-lg border border-gray-6 bg-gray-1/40 px-3 py-2 text-xs text-gray-10 space-y-1">
          <div>状态：{statusLabel()}</div>
          <Show when={props.serverUrl}>
            <div class="truncate font-mono">服务地址：{props.serverUrl}</div>
          </Show>
        </div>

        <div class="space-y-3">
          <TextInput
            label="用户名"
            value={username()}
            onInput={(event) => setUsername(event.currentTarget.value)}
            placeholder="请输入用户名"
            disabled={busy() !== "idle"}
          />
          <label class="block">
            <div class="mb-1 text-xs font-medium text-dls-secondary">密码</div>
            <input
              type="password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              placeholder="请输入密码"
              disabled={busy() !== "idle"}
              class="w-full rounded-lg bg-dls-surface px-3 py-2 text-sm text-dls-text placeholder:text-dls-secondary border border-dls-border shadow-sm focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.2)]"
            />
          </label>
        </div>

        <div class="flex gap-2">
          <Button
            variant="secondary"
            class="flex-1"
            onClick={() => void runAuth("register")}
            disabled={busy() !== "idle"}
          >
            {busy() === "register" ? "注册中..." : "注册"}
          </Button>
          <Button
            variant="primary"
            class="flex-1"
            onClick={() => void runAuth("login")}
            disabled={busy() !== "idle"}
          >
            {busy() === "login" ? "登录中..." : "登录"}
          </Button>
        </div>

        <Show when={message()}>
          <div
            class={`text-xs ${messageTone() === "ok" ? "text-green-11" : messageTone() === "error" ? "text-red-11" : "text-gray-10"}`}
            role="status"
            aria-live="polite"
          >
            {message()}
          </div>
        </Show>
      </div>
    </div>
  );
}
