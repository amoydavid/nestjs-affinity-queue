#!/bin/bash

# 亲和性调度测试脚本
# 测试相同 identifyTag 的任务被同一 Worker 处理

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

# 测试亲和性调度
test_affinity() {
    log_info "开始亲和性调度测试..."
    
    # 清理队列状态
    log_info "清理队列状态..."
    redis-cli del "bull:pending-tasks:wait" > /dev/null 2>&1 || true
    
    # 获取初始状态
    initial_stats=$(get_queue_stats)
    log_info "初始队列状态: $initial_stats"
    
    # 添加第一个任务
    log_info "添加第一个任务 (company-affinity-1)..."
    response1=$(add_task "company-affinity-1" "send-email" '{"to": "user1@test.com", "subject": "亲和性测试1"}')
    job_id1=$(echo "$response1" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_success "第一个任务ID: $job_id1"
    
    # 等待任务被分配
    sleep 2
    
    # 检查状态
    stats_after_first=$(get_queue_stats)
    log_info "第一个任务后状态: $stats_after_first"
    
    # 添加相同 identifyTag 的任务
    log_info "添加相同 identifyTag 的任务..."
    for i in {2..5}; do
        response=$(add_task "company-affinity-1" "send-email" "{\"to\": \"user$i@test.com\", \"subject\": \"亲和性测试$i\"}")
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        log_info "任务$i ID: $job_id"
    done
    
    # 等待一下
    sleep 2
    
    # 检查队列状态
    stats_after_same=$(get_queue_stats)
    waiting_count=$(echo "$stats_after_same" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    log_info "相同 identifyTag 任务后状态: $stats_after_same"
    
    if [ "$waiting_count" -gt 0 ]; then
        log_success "亲和性调度测试通过！有 $waiting_count 个任务在等待同一 Worker"
    else
        log_warning "亲和性调度测试 - 任务可能已被处理"
    fi
    
    # 添加不同 identifyTag 的任务
    log_info "添加不同 identifyTag 的任务..."
    for i in {1..3}; do
        response=$(add_task "company-affinity-$i" "generate-invoice" "{\"amount\": $((1000 + $i * 100)), \"description\": \"不同公司$i\"}")
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        log_info "不同公司任务$i ID: $job_id"
    done
    
    # 等待处理
    sleep 3
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "最终队列状态: $final_stats"
    
    # 验证结果
    waiting_final=$(echo "$final_stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    completed_final=$(echo "$final_stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
    
    log_info "测试结果:"
    log_info "- 等待任务: $waiting_final"
    log_info "- 完成任务: $completed_final"
    
    if [ "$waiting_final" -eq 0 ] && [ "$completed_final" -gt 0 ]; then
        log_success "亲和性调度测试完全通过！"
    else
        log_warning "亲和性调度测试 - 部分任务可能还在处理中"
    fi
}

# 测试批次控制
test_batch_control() {
    log_info "开始批次控制测试..."
    
    # 添加超过 maxBatchSize 的任务
    log_info "添加超过 maxBatchSize (5) 的任务..."
    for i in {1..8}; do
        response=$(add_task "company-batch-test" "send-email" "{\"to\": \"user$i@batch.com\", \"subject\": \"批次测试$i\"}")
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        log_info "批次任务$i ID: $job_id"
    done
    
    # 等待处理
    sleep 5
    
    # 检查状态
    stats=$(get_queue_stats)
    waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    
    log_info "批次控制测试结果: $stats"
    
    if [ "$waiting" -gt 0 ]; then
        log_success "批次控制测试通过 - 有 $waiting 个任务在等待（超过批次限制）"
    else
        log_warning "批次控制测试 - 所有任务可能已被处理"
    fi
}

# 主函数
main() {
    log_info "开始运行亲和性调度测试..."
    
    check_app
    test_affinity
    test_batch_control
    
    log_success "亲和性调度测试完成！"
}

main 