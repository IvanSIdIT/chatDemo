export async function readApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) {
      return payload.error;
    }
  } else {
    const text = (await response.text().catch(() => "")).trim();
    if (text) {
      if (response.status === 413 || /entity too large|payload too large/i.test(text)) {
        return "Файл слишком большой для прямой загрузки через сервер. Попробуйте снова — загрузка идёт напрямую в Storage.";
      }

      return text;
    }
  }

  if (response.status === 413) {
    return "Файл слишком большой. Максимальный размер PDF — 80 МБ.";
  }

  return `${fallback} (${response.status}).`;
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = (await response.text().catch(() => "")).trim();
    throw new Error(
      text || `Сервер вернул неожиданный ответ (${response.status}).`,
    );
  }

  return (await response.json()) as T;
}
