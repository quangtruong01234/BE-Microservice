export type UploadSignatureResponse = {
  signature: string;
  timestamp: number;
  api_key: string;
  cloud_name: string;
  folder: string;
  public_id: string;
  allowed_formats: string;
  // UPLOAD-SIZE-01 — camelCase on purpose: these are OURS, not Cloudinary
  // params, so a client forwarding the signed fields must not send them along.
  // They are informational (outside the signature) — see upload.constants.ts.
  maxBytes: number;
  maxVideoBytes?: number;
};
