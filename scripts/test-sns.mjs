import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { loadConfig } from '../backend/src/config.js';

const config = loadConfig();

async function main() {
  console.log('=== Testing AWS SNS Notification Dispatch ===\n');

  const topicArn = config.notifications.topicArn || process.env.SNS_TOPIC_ARN;
  if (!topicArn) {
    console.error('[FAIL] SNS_TOPIC_ARN is not configured in .env');
    process.exit(1);
  }

  const region = config.storage.region || 'ap-south-1';
  console.log(`Region    : ${region}`);
  console.log(`Topic ARN : ${topicArn}\n`);

  const client = new SNSClient({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    } : undefined
  });

  const subject = '[WareTrack 3D] WARNING: Low Stock Alert';
  const body = [
    '==================================================',
    ' WareTrack 3D Enterprise Live Alert',
    '==================================================',
    'Alert Level : WARNING',
    'Event       : Low Stock Detected',
    'Product     : 4K Action Camera (SKU: ELEC-CAM4)',
    'Rack Code   : A-01-02 (Warehouse: WH-01 WareTrack)',
    'Current Qty : 5 units (Reorder Level: 20 units)',
    `Timestamp   : ${new Date().toISOString()}`,
    '==================================================',
    'Action Required: Please arrange replenishment.',
    '',
    'Warehouse Dashboard: http://13.205.235.73:3000'
  ].join('\n');

  console.log('Sending live email notification to SNS topic subscribers...');
  const res = await client.send(new PublishCommand({
    TopicArn: topicArn,
    Subject: subject,
    Message: body
  }));

  console.log('\n[PASS] Message successfully published to AWS SNS!');
  console.log(`[PASS] AWS SNS Message ID : ${res.MessageId}`);
  console.log('\nCheck your email inbox to verify the live alert email has arrived.');
}

main().catch(err => {
  console.error('\n[FAIL] SNS Error:', err);
  process.exit(1);
});
