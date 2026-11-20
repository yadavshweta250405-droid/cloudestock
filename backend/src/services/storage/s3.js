/**
 * Amazon S3 storage provider.
 * Implements CONTRACTS.storage: ['put', 'get', 'delete', 'exists', 'publicUrl', 'list'].
 *
 * Uses the AWS SDK v3 (@aws-sdk/client-s3). Relies on the default credential provider chain
 * (IAM task/instance role in ECS/EC2, or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY locally).
 */
export class S3Storage {
  constructor({ bucket, prefix = '', region = 'us-east-1', cloudfrontUrl = '' } = {}) {
    if (!bucket) throw new Error('[storage:s3] S3_BUCKET is required when STORAGE_PROVIDER=s3');
    this.bucket = bucket;
    this.prefix = prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
    this.region = region;
    this.cloudfrontUrl = cloudfrontUrl ? cloudfrontUrl.replace(/\/+$/, '') : '';
    this.client = null;
  }

  async #getClient() {
    if (this.client) return this.client;
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const clientConfig = { region: this.region };

      // Optional explicit credentials from env (otherwise falls back to default AWS credential chain/IAM role)
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        clientConfig.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
        };
      }

      // Optional custom endpoint (e.g. LocalStack, MinIO, or custom S3 endpoint)
      const endpoint = process.env.AWS_ENDPOINT_URL || process.env.S3_ENDPOINT;
      if (endpoint) {
        clientConfig.endpoint = endpoint;
        clientConfig.forcePathStyle = true;
      }

      this.client = new S3Client(clientConfig);
      return this.client;
    } catch {
      throw new Error(
        '[storage:s3] Package "@aws-sdk/client-s3" is not installed. Run "npm install @aws-sdk/client-s3" to use S3 storage.',
      );
    }
  }

  fullKey(key) {
    const clean = String(key || '').replace(/^\/+/, '');
    return `${this.prefix}${clean}`;
  }

  rawKey(fullKey) {
    if (this.prefix && fullKey.startsWith(this.prefix)) {
      return fullKey.slice(this.prefix.length);
    }
    return fullKey;
  }

  async put(key, buffer, contentType = 'application/octet-stream') {
    const client = await this.#getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const fKey = this.fullKey(key);
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { key, size: buffer.length, contentType };
  }

  async get(key) {
    const client = await this.#getClient();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const res = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.fullKey(key),
        }),
      );
      const chunks = [];
      for await (const chunk of res.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async exists(key) {
    const client = await this.#getClient();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.fullKey(key),
        }),
      );
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async delete(key) {
    const client = await this.#getClient();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(key),
      }),
    );
  }

  async list(prefix = '') {
    const client = await this.#getClient();
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const out = [];
    let continuationToken;
    const searchPrefix = this.fullKey(prefix);

    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: searchPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      if (res.Contents) {
        for (const item of res.Contents) {
          if (item.Key) out.push(this.rawKey(item.Key));
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    return out;
  }

  publicUrl(key) {
    const fKey = this.fullKey(key);
    if (this.cloudfrontUrl) {
      return `${this.cloudfrontUrl}/${fKey}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${fKey}`;
  }
}

