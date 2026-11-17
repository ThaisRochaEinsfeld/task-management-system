/**
 * services/storage.js
 * ---------------------------------------------------------------
 * Where attachment files are stored.
 *
 *  - On AWS (S3_BUCKET is set): files go to a PRIVATE Amazon S3
 *    bucket. Downloads use pre-signed URLs that expire in 5 minutes.
 *    Credentials come from the EC2 instance role (LabInstanceProfile /
 *    LabRole), so there are no access keys in the code.
 *
 *  - Locally (S3_BUCKET is empty): files are saved in ./uploads so the
 *    app can be tested without an AWS account.
 *
 * The rest of the application only calls save(), remove() and
 * sendDownload(), so it does not need to know which option is active.
 */
const fs = require('fs/promises');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');
const logger = require('../logger');

const useS3 = Boolean(config.aws.s3Bucket);
const s3 = useS3 ? new S3Client({ region: config.aws.region }) : null;
const LOCAL_DIR = path.join(__dirname, '..', '..', 'uploads');

logger.info('Attachment storage configured', {
  mode: useS3 ? 's3' : 'local',
  bucket: useS3 ? config.aws.s3Bucket : undefined,
});

/** Stores a file under the given key. */
async function save(key, buffer, contentType) {
  if (useS3) {
    await s3.send(new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256', // encrypt the file at rest
    }));
    return;
  }

  const filePath = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

/** Deletes a file. Missing files are ignored. */
async function remove(key) {
  try {
    if (useS3) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.aws.s3Bucket, Key: key }));
    } else {
      await fs.unlink(path.join(LOCAL_DIR, key));
    }
  } catch (err) {
    // Not fatal: the database row is removed anyway, but we log it.
    logger.warn('Could not delete stored file', { key, error: err.message });
  }
}

/**
 * Sends the file to the browser.
 * With S3: redirect to a temporary pre-signed URL.
 * Locally: stream the file from disk.
 */
async function sendDownload(res, attachment) {
  // Content-Disposition makes the browser download the file with its
  // original name instead of opening it inside the page.
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`;

  if (useS3) {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: attachment.storage_key,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: 300 }, // 5 minutes
    );
    return res.redirect(url);
  }

  res.setHeader('Content-Type', attachment.mime_type);
  res.setHeader('Content-Disposition', disposition);
  return res.sendFile(path.join(LOCAL_DIR, attachment.storage_key));
}

module.exports = { save, remove, sendDownload };
