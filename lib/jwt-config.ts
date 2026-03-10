export const getJwtSecret = (): Uint8Array => {
  return new TextEncoder().encode(
    process.env.JWT_SECRET || "default_local_secret_dont_use_in_prod",
  );
};
