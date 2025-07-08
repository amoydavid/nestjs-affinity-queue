#!/bin/bash

# 多队列演示测试脚本
# 演示如何使用不同的队列处理不同类型的任务

echo "🚀 多队列演示测试"
echo "=================="

BASE_URL="http://localhost:3000"

# 检查服务是否启动
echo "📡 检查服务状态..."
curl -s $BASE_URL > /dev/null
if [ $? -ne 0 ]; then
    echo "❌ 服务未启动，请先运行 pnpm dev"
    exit 1
fi
echo "✅ 服务已启动"

echo ""
echo "📊 获取初始队列状态..."
curl -s $BASE_URL/multi-queue/stats | jq .

echo ""
echo "🎯 添加不同类型的任务到各个队列..."

# 1. 添加默认任务
echo ""
echo "1️⃣ 添加默认任务..."
curl -s -X POST $BASE_URL/multi-queue/default \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "company-default",
    "payload": {
      "id": 1,
      "action": "default-processing",
      "duration": 1000
    }
  }' | jq .

# 2. 添加紧急任务
echo ""
echo "2️⃣ 添加紧急任务..."
curl -s -X POST $BASE_URL/multi-queue/urgent \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "company-urgent",
    "payload": {
      "id": 2,
      "action": "urgent-processing",
      "duration": 500
    }
  }' | jq .

# 3. 添加关键任务
echo ""
echo "3️⃣ 添加关键任务..."
curl -s -X POST $BASE_URL/multi-queue/critical \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "company-critical",
    "payload": {
      "id": 3,
      "action": "critical-processing",
      "duration": 300
    }
  }' | jq .

# 4. 添加邮件任务
echo ""
echo "4️⃣ 添加邮件任务..."
curl -s -X POST $BASE_URL/multi-queue/email \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "user-email",
    "payload": {
      "id": 4,
      "recipient": "user@example.com",
      "subject": "Welcome Email",
      "duration": 2000
    }
  }' | jq .

# 5. 添加邮件简报任务
echo ""
echo "5️⃣ 添加邮件简报任务..."
curl -s -X POST $BASE_URL/multi-queue/newsletter \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "company-newsletter",
    "payload": {
      "id": 5,
      "subscriberCount": 100,
      "topic": "Monthly Newsletter",
      "duration": 3000
    }
  }' | jq .

# 6. 添加文件处理任务
echo ""
echo "6️⃣ 添加文件处理任务..."
curl -s -X POST $BASE_URL/multi-queue/file-processing \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "company-files",
    "payload": {
      "id": 6,
      "fileName": "document.pdf",
      "action": "process",
      "duration": 5000
    }
  }' | jq .

# 7. 添加文件压缩任务
echo ""
echo "7️⃣ 添加文件压缩任务..."
curl -s -X POST $BASE_URL/multi-queue/file-compression \
  -H "Content-Type: application/json" \
  -d '{
    "identifyTag": "company-compression",
    "payload": {
      "id": 7,
      "fileName": "image.jpg",
      "action": "compress",
      "compressionRatio": "70%",
      "duration": 4000
    }
  }' | jq .

echo ""
echo "⏳ 等待 3 秒查看任务处理状态..."
sleep 3

echo ""
echo "📊 获取处理后的队列状态..."
curl -s $BASE_URL/multi-queue/stats | jq .

echo ""
echo "🎭 批量演示：添加 21 个任务到各种队列..."
curl -s -X POST "$BASE_URL/multi-queue/demo?count=21&companies=3" \
  -H "Content-Type: application/json" | jq .

echo ""
echo "⏳ 等待 5 秒查看批量任务处理状态..."
sleep 5

echo ""
echo "📊 获取最终队列状态..."
curl -s $BASE_URL/multi-queue/stats | jq .

echo ""
echo "✅ 多队列演示完成！"
echo ""
echo "📌 演示说明："
echo "   - 默认队列：处理常规任务"
echo "   - 高优先级队列：处理紧急和关键任务"
echo "   - 邮件队列：处理邮件发送任务"
echo "   - 文件处理队列：处理文件相关任务"
echo ""
echo "🔍 可以通过以下端点监控各队列状态："
echo "   GET $BASE_URL/multi-queue/stats"
echo ""
echo "💡 查看应用日志以观察任务处理过程！"