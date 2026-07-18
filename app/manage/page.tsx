import { env } from "cloudflare:workers";
import CatalogApp from "../CatalogApp";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const user = await requireChatGPTUser("/manage");
  const adminEmail = String((env as unknown as { ADMIN_EMAIL?: string }).ADMIN_EMAIL ?? "").toLowerCase();

  if (!adminEmail || user.email.toLowerCase() !== adminEmail) {
    return (
      <main className="access-denied">
        <div>
          <span className="brand-mark">AB</span>
          <h1>这个账号没有管理权限</h1>
          <p>请使用店主的 ChatGPT 账号登录。</p>
          <a href={chatGPTSignOutPath("/manage")}>更换账号</a>
          <a className="secondary-link" href="/">返回商品页</a>
        </div>
      </main>
    );
  }

  return <CatalogApp adminMode adminName={user.displayName} />;
}
