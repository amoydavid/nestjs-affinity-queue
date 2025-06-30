#!/bin/bash

# 简单的 Worker 测试脚本
# 测试 Worker 的日志输出

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

# 测试 Worker 日志
test_worker_logs() {
    log_info "开始测试 Worker 日志输出..."
    
    # 获取初始状态
    initial_stats=$(get_queue_stats)
    log_info "初始队列状态: $initial_stats"
    
    # 添加一个邮件任务
    log_info "添加邮件发送任务..."
    response=$(add_task "simple-test" "send-email" '{"to": "test@simple.com", "subject": "简单测试邮件"}')
    job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_success "任务已添加，ID: $job_id"
    
    # 等待任务处理
    log_info "等待任务处理..."
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
        
        sleep 1
    done
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "最终队列状态: $final_stats"
    
    # 添加不同类型的任务
    log_info "添加不同类型的任务..."
    
    # 发票任务
    response1=$(add_task "simple-invoice" "generate-invoice" '{"amount": 1000, "description": "简单测试发票"}')
    job_id1=$(echo "$response1" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "发票任务ID: $job_id1"
    
    # 数据处理任务
    response2=$(add_task "simple-data" "process-data" '{"recordCount": 50, "operation": "简单测试数据处理"}')
    job_id2=$(echo "$response2" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "数据处理任务ID: $job_id2"
    
    # 等待处理
    log_info "等待所有任务处理完成..."
    for i in {1..15}; do
        stats=$(get_queue_stats)
        waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        active=$(echo "$stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        completed=$(echo "$stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
        
        log_info "状态检查 $i/15: 等待=$waiting, 活跃=$active, 完成=$completed"
        
        if [ "$waiting" -eq 0 ] && [ "$active" -eq 0 ] && [ "$completed" -ge 3 ]; then
            log_success "所有任务处理完成！"
            break
        fi
        
        sleep 1
    done
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "最终队列状态: $final_stats"
    
    log_success "Worker 日志测试完成！"
    log_info ""
    log_info "请检查应用控制台日志，应该包含以下信息："
    log_info "1. Worker 开始处理任务的日志"
    log_info "2. 任务处理器执行的日志"
    log_info "3. 任务完成和状态更新的日志"
}

# 主函数
main() {
    log_info "开始运行简单的 Worker 测试..."
    
    check_app
    test_worker_logs
    
    log_success "简单 Worker 测试完成！"
}

main 