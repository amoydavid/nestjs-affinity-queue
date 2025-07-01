#!/bin/bash

echo "🚀 测试分布式调度器选举功能"
echo "=================================="

# 停止现有的进程
echo "📋 停止现有进程..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# 编译项目
echo "🔨 编译项目..."
npm run build

# 启动选举模式
echo "🎯 启动选举模式（所有实例都是 BOTH 模式）..."
pm2 start ecosystem-election.config.js

# 等待进程启动
echo "⏳ 等待进程启动..."
sleep 5

# 显示进程状态
echo "📊 进程状态："
pm2 list

# 显示日志
echo "📝 最近的日志："
pm2 logs --lines 20

echo ""
echo "🔍 检查选举状态..."
echo "=================================="

# 检查 Redis 中的选举信息
echo "📋 Redis 中的选举信息："
redis-cli get scheduler:election:lock
redis-cli get scheduler:leader:info
redis-cli hgetall scheduler:worker:registry

echo ""
echo "📈 监控日志（按 Ctrl+C 停止）："
echo "=================================="

# 实时监控日志
pm2 logs --lines 0 