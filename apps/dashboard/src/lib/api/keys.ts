import { api, unwrap } from "./client";
import type { paths } from "./generated";
type KeyInput =
  paths["/api/v1/me/keys"]["post"]["requestBody"]["content"]["application/json"];
export async function createPersonalKey(body: KeyInput) {
  return unwrap(await api.POST("/api/v1/me/keys", { body }));
}
