#!/bin/bash
# 產生 macOS + Windows 自簽憑證
# 用法：bash electron/scripts/gen-certs.sh
# 憑證存於 electron/certs/（已加入 .gitignore，不會上傳）

set -e
cd "$(dirname "$0")/.."
mkdir -p certs
cd certs

PASS="obsbot-selfsigned"

echo "產生 macOS 簽署憑證 (.p12)..."
openssl req -x509 -newkey rsa:2048 \
  -keyout mac-key.pem -out mac-cert.pem \
  -days 3650 -nodes \
  -subj "/CN=ObsBot Mac Developer/O=ObsBot/C=TW"

openssl pkcs12 -export \
  -out obsbot-mac.p12 \
  -inkey mac-key.pem \
  -in mac-cert.pem \
  -passout pass:$PASS

echo "產生 Windows 簽署憑證 (.pfx)..."
openssl req -x509 -newkey rsa:2048 \
  -keyout win-key.pem -out win-cert.pem \
  -days 3650 -nodes \
  -subj "/CN=ObsBot Windows Developer/O=ObsBot/C=TW"

openssl pkcs12 -export \
  -out obsbot-win.pfx \
  -inkey win-key.pem \
  -in win-cert.pem \
  -passout pass:$PASS

echo ""
echo "✅ 憑證已產生於 electron/certs/"
echo ""
echo "下一步：將以下值加入 GitHub Secrets"
echo "================================================"
echo ""
echo "Secret 名稱：MAC_CERT_BASE64"
echo "Secret 值（複製以下輸出）："
base64 -i obsbot-mac.p12
echo ""
echo "Secret 名稱：WIN_CERT_BASE64"
echo "Secret 值（複製以下輸出）："
base64 -i obsbot-win.pfx
echo ""
echo "Secret 名稱：CERT_PASSWORD"
echo "Secret 值：$PASS"
echo "================================================"

# 清理 pem 暫存
rm -f mac-key.pem mac-cert.pem win-key.pem win-cert.pem
