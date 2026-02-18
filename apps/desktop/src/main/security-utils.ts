export type SecretFinding = {
  rule: string;
  line: number;
  excerpt: string;
};

type SecretRule = {
  name: string;
  pattern: RegExp;
};

const SECRET_RULES: SecretRule[] = [
  {
    name: "private_key_block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  },
  {
    name: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: "github_token",
    pattern: /\bghp_[A-Za-z0-9]{30,}\b/
  },
  {
    name: "slack_token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
  },
  {
    name: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i
  },
  {
    name: "credential_assignment",
    pattern: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i
  }
];

export function scanSecretFindings(content: string, limit = 25): SecretFinding[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const findings: SecretFinding[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          rule: rule.name,
          line: idx + 1,
          excerpt: line.slice(0, 180)
        });
      }
      if (findings.length >= limit) {
        return findings;
      }
    }
  }
  return findings;
}

export function hasSecrets(content: string): boolean {
  return scanSecretFindings(content, 1).length > 0;
}

export function redactSecrets(text: string): string {
  let output = text;
  output = output.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  output = output.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
  output = output.replace(/\bghp_[A-Za-z0-9]{30,}\b/g, "[REDACTED_GITHUB_TOKEN]");
  output = output.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]");
  output = output.replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, "Bearer [REDACTED_TOKEN]");
  output = output.replace(
    /\b(api[_-]?key|secret|token|password)\b\s*([:=])\s*(["'])([^"'\n]{4,})(["'])/gi,
    (_full, key: string, sep: string, q1: string, _value: string, q2: string) =>
      `${key}${sep}${q1}[REDACTED]${q2}`
  );
  return output;
}

function isSensitiveKey(key: string): boolean {
  return /(secret|token|password|api[_-]?key|authorization|credential|private[_-]?key)/i.test(key);
}

export function redactAuditValue(value: unknown, keyHint = ""): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return isSensitiveKey(keyHint) ? "[REDACTED]" : redactSecrets(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item, keyHint));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactAuditValue(item, key);
    }
    return out;
  }
  return String(value);
}
