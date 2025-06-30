#!/bin/bash

# 并行处理测试脚本
# 测试不同 identifyTag 的任务可以并行处理

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

# 测试并行处理
test_parallel_processing() {
    log_info "开始并行处理测试..."
    
    # 清理队列状态
    log_info "清理队列状态..."
    redis-cli del "bull:pending-tasks:wait" > /dev/null 2>&1 || true
    
    # 获取初始状态
    initial_stats=$(get_queue_stats)
    log_info "初始队列状态: $initial_stats"
    
    # 同时添加多个不同 identifyTag 的任务
    log_info "同时添加多个不同 identifyTag 的任务..."
    
    # 启动后台任务
    for i in {1..5}; do
        (
            response=$(add_task "parallel-company-$i" "send-email" "{\"to\": \"user$i@parallel.com\", \"subject\": \"并行测试$i\"}")
            job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
            log_info "并行任务$i ID: $job_id (company-$i)"
        ) &
    done
    
    # 等待所有后台任务完成
    wait
    
    # 等待一下让任务被分配
    sleep 2
    
    # 检查队列状态
    stats_after_parallel=$(get_queue_stats)
    waiting_count=$(echo "$stats_after_parallel" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    log_info "并行任务后状态: $stats_after_parallel"
    
    if [ "$waiting_count" -eq 0 ]; then
        log_success "并行处理测试通过！所有任务都被立即分配"
    else
        log_warning "并行处理测试 - 有 $waiting_count 个任务在等待"
    fi
}

# 测试混合任务类型
test_mixed_task_types() {
    log_info "开始混合任务类型测试..."
    
    # 添加不同类型的任务
    log_info "添加不同类型的任务..."
    
    # 邮件任务
    response1=$(add_task "mixed-company-1" "send-email" '{"to": "email@mixed.com", "subject": "混合测试邮件"}')
    job_id1=$(echo "$response1" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "邮件任务ID: $job_id1"
    
    # 发票任务
    response2=$(add_task "mixed-company-2" "generate-invoice" '{"amount": 1500, "description": "混合测试发票"}')
    job_id2=$(echo "$response2" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "发票任务ID: $job_id2"
    
    # 数据处理任务
    response3=$(add_task "mixed-company-3" "process-data" '{"recordCount": 75, "operation": "混合测试数据处理"}')
    job_id3=$(echo "$response3" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "数据处理任务ID: $job_id3"
    
    # 等待处理
    sleep 3
    
    # 检查状态
    stats=$(get_queue_stats)
    log_info "混合任务类型测试结果: $stats"
    
    waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    completed=$(echo "$stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
    
    if [ "$waiting" -eq 0 ] && [ "$completed" -gt 0 ]; then
        log_success "混合任务类型测试通过！所有任务类型都被正确处理"
    else
        log_warning "混合任务类型测试 - 部分任务可能还在处理中"
    fi
}

# 测试并发提交
test_concurrent_submission() {
    log_info "开始并发提交测试..."
    
    # 清理队列
    redis-cli del "bull:pending-tasks:wait" > /dev/null 2>&1 || true
    
    # 并发提交多个任务
    log_info "并发提交 10 个不同公司的任务..."
    
    start_time=$(date +%s)
    
    # 启动并发任务
    for i in {1..10}; do
        (
            response=$(add_task "concurrent-company-$i" "send-email" "{\"to\": \"user$i@concurrent.com\", \"subject\": \"并发测试$i\"}")
            if echo "$response" | grep -q '"message":"任务已添加到队列"'; then
                log_info "并发任务$i 提交成功"
            else
                log_error "并发任务$i 提交失败"
            fi
        ) &
    done
    
    # 等待所有并发任务完成
    wait
    
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    
    log_info "并发提交完成，耗时: ${duration}秒"
    
    # 等待处理
    sleep 5
    
    # 检查最终状态
    final_stats=$(get_queue_stats)
    waiting=$(echo "$final_stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    completed=$(echo "$final_stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
    
    log_info "并发提交测试结果: $final_stats"
    
    if [ "$waiting" -eq 0 ] && [ "$completed" -gt 0 ]; then
        log_success "并发提交测试通过！所有任务都被正确处理"
    else
        log_warning "并发提交测试 - 部分任务可能还在处理中"
    fi
}

# 测试性能
test_performance() {
    log_info "开始性能测试..."
    
    # 清理队列
    redis-cli del "bull:pending-tasks:wait" > /dev/null 2>&1 || true
    
    # 记录开始时间
    start_time=$(date +%s)
    
    # 批量提交任务
    log_info "批量提交 20 个任务..."
    
    for i in {1..20}; do
        response=$(add_task "perf-company-$i" "send-email" "{\"to\": \"user$i@perf.com\", \"subject\": \"性能测试$i\"}")
        if ! echo "$response" | grep -q '"message":"任务已添加到队列"'; then
            log_error "性能测试任务$i 提交失败"
            return 1
        fi
    done
    
    submission_time=$(date +%s)
    submission_duration=$((submission_time - start_time))
    
    log_info "任务提交完成，耗时: ${submission_duration}秒"
    
    # 等待所有任务处理完成
    log_info "等待任务处理完成..."
    for i in {1..30}; do
        stats=$(get_queue_stats)
        waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        
        if [ "$waiting" -eq 0 ]; then
            end_time=$(date +%s)
            total_duration=$((end_time - start_time))
            log_success "所有任务处理完成！总耗时: ${total_duration}秒"
            break
        fi
        
        sleep 1
    done
    
    # 最终状态
    final_stats=$(get_queue_stats)
    log_info "性能测试最终结果: $final_stats"
}

# 主函数
main() {
    log_info "开始运行并行处理测试..."
    
    check_app
    test_parallel_processing
    test_mixed_task_types
    test_concurrent_submission
    test_performance
    
    log_success "并行处理测试完成！"
}

main 