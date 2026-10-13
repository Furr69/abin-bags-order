export async function downloadBackupImage(url, fetchImage = fetch) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchImage(url, { signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new Error('登录已失效，请重新登录后导出');
      if (response.status === 404) throw new Error('服务器上找不到这张图片');
      if (!response.ok) throw new Error(`图片服务返回 ${response.status}`);
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const valid = (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        || (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
        || (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80);
      if (!valid) throw new Error('返回内容不是有效图片，可能被网络登录页面拦截');
      return blob;
    } catch (error) {
      lastError = error;
      if (error.message?.includes('登录已失效') || error.message?.includes('找不到')) break;
    } finally { clearTimeout(timer); }
  }
  throw new Error(`图片下载失败：${lastError?.name === 'AbortError' ? '网络超时，已重试 3 次' : lastError?.message || '网络连接中断'}`);
}
