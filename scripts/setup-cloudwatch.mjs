import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, PutMetricAlarmCommand, PutDashboardCommand } from '@aws-sdk/client-cloudwatch';
import { loadConfig } from '../backend/src/config.js';

const config = loadConfig();
const region = config.storage.region || 'ap-south-1';
const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
} : undefined;

const topicArn = config.notifications.topicArn || 'arn:aws:sns:ap-south-1:912759111205:waretrack3d-alerts';

async function main() {
  console.log('=== Automated CloudWatch Alarms & Dashboard Setup ===\n');

  // 1. Find EC2 instance ID
  const ec2 = new EC2Client({ region, credentials });
  const instRes = await ec2.send(new DescribeInstancesCommand({}));

  let instanceId = null;
  let instanceName = 'waretrack3d-server';

  for (const r of instRes.Reservations || []) {
    for (const inst of r.Instances || []) {
      const nameTag = (inst.Tags || []).find(t => t.Key === 'Name')?.Value;
      if (nameTag === 'waretrack3d-server' || inst.PublicIpAddress === '13.205.235.73') {
        instanceId = inst.InstanceId;
        instanceName = nameTag || inst.InstanceId;
        break;
      }
    }
  }

  if (!instanceId) {
    // Fallback: pick the first available instance if any
    const first = instRes.Reservations?.[0]?.Instances?.[0];
    if (first) {
      instanceId = first.InstanceId;
      instanceName = (first.Tags || []).find(t => t.Key === 'Name')?.Value || first.InstanceId;
    }
  }

  console.log(`[EC2 Info] Found Instance: ${instanceName} (${instanceId})`);
  const rdsDbId = 'waretrack3d-db';
  console.log(`[RDS Info] Target Database : ${rdsDbId}\n`);

  const cw = new CloudWatchClient({ region, credentials });

  // 2. Create EC2 CPU High Alarm
  console.log('1. Creating EC2 CPU Utilization Alarm...');
  await cw.send(new PutMetricAlarmCommand({
    AlarmName: 'waretrack3d-ec2-high-cpu',
    AlarmDescription: 'Triggers when WareTrack3D EC2 CPU exceeds 70% for 5 minutes',
    MetricName: 'CPUUtilization',
    Namespace: 'AWS/EC2',
    Statistic: 'Average',
    Period: 300,
    EvaluationPeriods: 1,
    Threshold: 70.0,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    Dimensions: [
      { Name: 'InstanceId', Value: instanceId }
    ],
    AlarmActions: [topicArn],
    OKActions: [topicArn]
  }));
  console.log('   [PASS] Alarm "waretrack3d-ec2-high-cpu" configured with SNS notification!\n');

  // 3. Create RDS Connections High Alarm
  console.log('2. Creating RDS Database Connections Alarm...');
  await cw.send(new PutMetricAlarmCommand({
    AlarmName: 'waretrack3d-rds-high-connections',
    AlarmDescription: 'Triggers when WareTrack3D RDS connections exceed 30',
    MetricName: 'DatabaseConnections',
    Namespace: 'AWS/RDS',
    Statistic: 'Average',
    Period: 300,
    EvaluationPeriods: 1,
    Threshold: 30.0,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    Dimensions: [
      { Name: 'DBInstanceIdentifier', Value: rdsDbId }
    ],
    AlarmActions: [topicArn],
    OKActions: [topicArn]
  }));
  console.log('   [PASS] Alarm "waretrack3d-rds-high-connections" configured with SNS notification!\n');

  // 4. Create Executive Live Dashboard
  console.log('3. Building Executive Live Dashboard "waretrack3d-monitoring"...');
  const dashboardBody = {
    widgets: [
      {
        type: 'metric',
        x: 0,
        y: 0,
        width: 12,
        height: 6,
        properties: {
          metrics: [
            ['AWS/EC2', 'CPUUtilization', 'InstanceId', instanceId, { label: 'EC2 Server CPU %' }]
          ],
          period: 300,
          stat: 'Average',
          region: region,
          title: '🖥️ EC2 Server CPU Utilization (%)',
          yAxis: { left: { min: 0, max: 100 } }
        }
      },
      {
        type: 'metric',
        x: 12,
        y: 0,
        width: 12,
        height: 6,
        properties: {
          metrics: [
            ['AWS/RDS', 'DatabaseConnections', 'DBInstanceIdentifier', rdsDbId, { label: 'Active DB Connections' }]
          ],
          period: 300,
          stat: 'Average',
          region: region,
          title: '🗄️ RDS Active Database Connections (Count)',
          yAxis: { left: { min: 0 } }
        }
      },
      {
        type: 'metric',
        x: 0,
        y: 6,
        width: 12,
        height: 6,
        properties: {
          metrics: [
            ['AWS/EC2', 'NetworkIn', 'InstanceId', instanceId, { label: 'Network In (Bytes)' }],
            ['AWS/EC2', 'NetworkOut', 'InstanceId', instanceId, { label: 'Network Out (Bytes)' }]
          ],
          period: 300,
          stat: 'Sum',
          region: region,
          title: '🌐 EC2 Network Traffic (In/Out Bytes)'
        }
      },
      {
        type: 'metric',
        x: 12,
        y: 6,
        width: 12,
        height: 6,
        properties: {
          metrics: [
            ['AWS/RDS', 'CPUUtilization', 'DBInstanceIdentifier', rdsDbId, { label: 'RDS CPU %' }],
            ['AWS/RDS', 'FreeStorageSpace', 'DBInstanceIdentifier', rdsDbId, { label: 'Free Storage (Bytes)' }]
          ],
          period: 300,
          stat: 'Average',
          region: region,
          title: '⚡ RDS Database Health & Storage'
        }
      }
    ]
  };

  await cw.send(new PutDashboardCommand({
    DashboardName: 'waretrack3d-monitoring',
    DashboardBody: JSON.stringify(dashboardBody)
  }));
  console.log('   [PASS] Dashboard "waretrack3d-monitoring" created successfully with 4 live widgets!\n');

  console.log('=== SETUP COMPLETE ===');
  console.log('Dashboard Link: https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#dashboards:name=waretrack3d-monitoring');
}

main().catch(err => {
  console.error('[FAIL] Setup error:', err);
  process.exit(1);
});
