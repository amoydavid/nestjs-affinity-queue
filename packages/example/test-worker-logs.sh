#!/bin/bash

# Worker 日志测试脚本
# 专门测试 Worker 的日志输出

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BASE_URL="http://localhost:3000"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查应用是否运行
check_app() {
    if ! curl -s "$BASE_URL" > /dev/null 2>&1; then
        log_error "应用未运行，请先启动应用"
        exit 1
    fi
}

# 获取队列状态
get_queue_stats() {
    curl -s "$BASE_URL/queue/stats"
}

# 添加任务
add_task() {
    local identify_tag="$1"
    local task_type="$2"
    local payload="$3"
    
    response=$(curl -s -X POST "$BASE_URL/tasks" \
        -H "Content-Type: application/json" \
        -d "{
            \"type\": \"$task_type\",
            \"identifyTag\": \"$identify_tag\",
            \"payload\": $payload
        }")
    
    echo "$response"
}

# 清理 Redis 状态
cleanup_redis() {
    log_info "清理 Redis 状态..."
    redis-cli del "bull:pending-tasks:wait" > /dev/null 2>&1 || true
    redis-cli del "bull:pending-tasks:active" > /dev/null 2>&1 || true
    redis-cli del "bull:pending-tasks:completed" > /dev/null 2>&1 || true
    redis-cli del "bull:pending-tasks:failed" > /dev/null 2>&1 || true
    
    # 清理 Worker 状态
    redis-cli keys "*worker*state*" | xargs redis-cli del > /dev/null 2>&1 || true
    
    # 清理 Worker 队列
    redis-cli keys "*worker-queue*" | xargs redis-cli del > /dev/null 2>&1 || true
}

# 测试 Worker 启动日志
test_worker_startup() {
    log_info "测试 Worker 启动日志..."
    
    # 检查应用日志中是否有 Worker 启动信息
    log_info "请检查应用启动日志中是否包含以下信息："
    log_info "- [DynamicWorkerProcessor] Worker worker-0-xxxxxxxxx 已启动"
    log_info "- [TaskHandlerService] 所有任务处理器已注册"
    log_info "- [DynamicWorkerProcessor] 已注册任务处理器: send-email"
    log_info "- [DynamicWorkerProcessor] 已注册任务处理器: generate-invoice"
    log_info "- [DynamicWorkerProcessor] 已注册任务处理器: process-data"
}

# 测试任务处理日志
test_task_processing_logs() {
    log_info "测试任务处理日志..."
    
    # 清理状态
    cleanup_redis
    
    # 获取初始状态
    initial_stats=$(get_queue_stats)
    log_info "初始队列状态: $initial_stats"
    
    # 添加一个简单的邮件任务
    log_info "添加邮件发送任务..."
    response=$(add_task "log-test-company" "send-email" '{"to": "test@logs.com", "subject": "日志测试邮件"}')
    job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_success "任务已添加，ID: $job_id"
    
    # 等待任务被分配和处理
    log_info "等待任务被分配和处理..."
    for i in {1..10}; do
        stats=$(get_queue_stats)
        waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        active=$(echo "$stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        completed=$(echo "$stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
        
        log_info "状态检查 $i/10: 等待=$waiting, 活跃=$active, 完成=$completed"
        
        if [ "$waiting" -eq 0 ] && [ "$active" -eq 0 ] && [ "$completed" -gt 0 ]; then
            log_success "任务处理完成！"
            break
        fi
        
        sleep 2
    done
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "最终队列状态: $final_stats"
}

# 测试不同任务类型的日志
test_different_task_logs() {
    log_info "测试不同任务类型的日志..."
    
    # 清理状态
    cleanup_redis
    
    # 添加不同类型的任务
    log_info "添加邮件发送任务..."
    response1=$(add_task "log-test-email" "send-email" '{"to": "email@test.com", "subject": "邮件日志测试"}')
    job_id1=$(echo "$response1" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "邮件任务ID: $job_id1"
    
    log_info "添加发票生成任务..."
    response2=$(add_task "log-test-invoice" "generate-invoice" '{"amount": 1000, "description": "发票日志测试"}')
    job_id2=$(echo "$response2" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "发票任务ID: $job_id2"
    
    log_info "添加数据处理任务..."
    response3=$(add_task "log-test-data" "process-data" '{"recordCount": 50, "operation": "数据日志测试"}')
    job_id3=$(echo "$response3" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "数据处理任务ID: $job_id3"
    
    # 等待处理
    log_info "等待所有任务处理完成..."
    for i in {1..15}; do
        stats=$(get_queue_stats)
        waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        active=$(echo "$stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        completed=$(echo "$stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
        
        log_info "状态检查 $i/15: 等待=$waiting, 活跃=$active, 完成=$completed"
        
        if [ "$waiting" -eq 0 ] && [ "$active" -eq 0 ] && [ "$completed" -ge 3 ]; then
            log_success "所有任务类型处理完成！"
            break
        fi
        
        sleep 2
    done
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "最终队列状态: $final_stats"
}

# 测试 Worker 状态日志
test_worker_state_logs() {
    log_info "测试 Worker 状态日志..."
    
    # 清理状态
    cleanup_redis
    
    # 添加超过批次大小的任务
    log_info "添加超过 maxBatchSize (5) 的任务来测试状态重置..."
    for i in {1..7}; do
        response=$(add_task "state-test-company" "send-email" "{\"to\": \"user$i@state.com\", \"subject\": \"状态测试$i\"}")
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        log_info "状态测试任务$i ID: $job_id"
    done
    
    # 等待处理
    log_info "等待任务处理，观察状态重置日志..."
    for i in {1..20}; do
        stats=$(get_queue_stats)
        waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        active=$(echo "$stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        completed=$(echo "$stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
        
        log_info "状态检查 $i/20: 等待=$waiting, 活跃=$active, 完成=$completed"
        
        if [ "$waiting" -eq 0 ] && [ "$active" -eq 0 ]; then
            log_success "所有任务处理完成！"
            break
        fi
        
        sleep 2
    done
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "最终队列状态: $final_stats"
}

# 检查 Redis 中的 Worker 状态
check_redis_worker_states() {
    log_info "检查 Redis 中的 Worker 状态..."
    
    # 查找所有 Worker 状态
    worker_states=$(redis-cli keys "*worker*state*" 2>/dev/null || echo "")
    
    if [ -z "$worker_states" ]; then
        log_warning "Redis 中没有找到 Worker 状态"
    else
        log_info "找到 Worker 状态:"
        echo "$worker_states" | while read -r state_key; do
            if [ ! -z "$state_key" ]; then
                state_data=$(redis-cli hgetall "$state_key" 2>/dev/null || echo "")
                log_info "状态键: $state_key"
                log_info "状态数据: $state_data"
            fi
        done
    fi
    
    # 查找 Worker 队列
    worker_queues=$(redis-cli keys "*worker-queue*" 2>/dev/null || echo "")
    
    if [ -z "$worker_queues" ]; then
        log_warning "Redis 中没有找到 Worker 队列"
    else
        log_info "找到 Worker 队列:"
        echo "$worker_queues" | while read -r queue_key; do
            if [ ! -z "$queue_key" ]; then
                queue_length=$(redis-cli llen "$queue_key" 2>/dev/null || echo "0")
                log_info "队列: $queue_key, 长度: $queue_length"
            fi
        done
    fi
}

# 主函数
main() {
    log_info "开始运行 Worker 日志测试..."
    
    check_app
    test_worker_startup
    test_task_processing_logs
    test_different_task_logs
    test_worker_state_logs
    check_redis_worker_states
    
    log_success "Worker 日志测试完成！"
    log_info ""
    log_info "请检查应用控制台日志，应该包含以下信息："
    log_info "1. Worker 启动日志"
    log_info "2. 任务处理器注册日志"
    log_info "3. 任务处理开始和完成日志"
    log_info "4. Worker 状态重置日志"
}

main 