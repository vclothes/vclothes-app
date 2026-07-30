import { createServerFn } from "@tanstack/react-start";
import { getSession } from "@tanstack/react-start/server";

import { getCloudflareEnv } from "./cloudflareEnv";
import { generateTryOnImage } from "./idmVton";
import { GARMENT_PHOTOS_BASE64 } from "./garmentPhotos";
import { sessionConfig, userKey, type SessionData, type StoredUser } from "./auth";
import { PRODUCTS } from "./products";

export type TryOnResult = { imageDataUri: string };

function tryOnCacheKey(username: string, productId: string) {
  return `tryon:${username}:${productId}`;
}

// Generates (or returns the already-cached) 2D try-on photo for the logged-in
// person wearing the given product — real photo + real garment photo composed
// by IDM-VTON (see idmVton.ts), not a 3D render. Cached per (person, product)
// in KV so trying the same look again is instant instead of re-hitting the
// free public model every time.
export const generateTryOn = createServerFn({ method: "POST" })
  .validator((data: { productId: string }) => data)
  .handler(async ({ data }): Promise<TryOnResult> => {
    const session = await getSession<SessionData>(sessionConfig());
    const username = session.data.username;
    if (!username) throw new Error("Não autenticado.");

    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) throw new Error("Armazenamento indisponível no servidor.");

    const cacheKey = tryOnCacheKey(username, data.productId);
    const cached = await kv.get(cacheKey);
    if (cached) return { imageDataUri: cached };

    const product = PRODUCTS.find((p) => p.id === data.productId);
    if (!product) throw new Error("Produto não encontrado.");

    const garmentBase64 = GARMENT_PHOTOS_BASE64[data.productId];
    if (!garmentBase64) throw new Error("Esse produto ainda não tem foto compatível para try-on.");

    const raw = await kv.get(userKey(username));
    if (!raw) throw new Error("Usuário não encontrado.");
    const user = JSON.parse(raw) as StoredUser;
    if (!user.frontPhotoBase64) {
      throw new Error(
        "Não encontramos sua foto do escaneamento. Refaça o escaneamento para poder experimentar.",
      );
    }

    const imageDataUri = await generateTryOnImage(
      user.frontPhotoBase64,
      garmentBase64,
      product.tryOnDescription,
    );

    // Best-effort cache write — a KV hiccup here shouldn't turn an already
    // successful generation into an error for the person waiting on it.
    await kv.put(cacheKey, imageDataUri).catch((err) => {
      console.error("[tryOn] failed to cache result", err);
    });

    return { imageDataUri };
  });
