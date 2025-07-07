#!/bin/bash

# 多队列功能测试脚本
# 测试默认队列和高优先级队列的独立运行

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
    log_success "应用正在运行"
}

# 获取队列状态
get_queue_stats() {
    local queue_name="$1"
    local url="$BASE_URL/queue/stats"
    if [ "$queue_name" == "high-priority" ]; then
        url="$BASE_URL/queue/stats/high-priority"
    fi
    curl -s "$url"
}

# 添加任务
add_task() {
    local queue_name="$1"
    local identify_tag="$2"
    local task_type="$3"
    local payload="$4"
    
    local url="$BASE_URL/tasks"
    if [ "$queue_name" == "high-priority" ]; then
        url="$BASE_URL/tasks/high-priority"
    fi

    response=$(curl -s -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "{
            \"type\": \"$task_type\",
            \"identifyTag\": \"$identify_tag\",
            \"payload\": $payload
        }")
    
    echo "$response"
}

# 测试多队列功能
test_multi_queue() {
    log_info "=================================================="
    log_info "          开始测试多队列独立运行功能"
    log_info "=================================================="

    # 1. 向默认队列添加任务
    log_info "(1/4) 向默认队列添加 3 个任务 (company-default-1)..."
    for i in {1..3}; do
        add_task "default" "company-default-1" "send-email" "{\"content\": \"Default task $i\"}" > /dev/null
    done
    log_success "3 个任务已添加到默认队列。"

    # 2. 向高优先级队列添加任务
    log_info "(2/4) 向高优先级队列添加 2 个任务 (company-hp-1)..."
    for i in {1..2}; do
        add_task "high-priority" "company-hp-1" "generate-invoice" "{\"content\": \"High-priority task $i\"}" > /dev/null
    done
    log_success "2 个任务已添加到高优先级队列。"

    echo ""
    log_info "(3/4) 监控两个队列的状态，等待所有任务处理完成..."
    log_info "(预计默认队列耗时较长，高优先级队列处理更快)"
    echo ""

    # 3. 监控两个队列的状态
    for i in {1..20}; do
        default_stats=$(get_queue_stats "default")
        hp_stats=$(get_queue_stats "high-priority")

        default_waiting=$(echo "$default_stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        default_active=$(echo "$default_stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        default_completed=$(echo "$default_stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)

        hp_waiting=$(echo "$hp_stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        hp_active=$(echo "$hp_stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        hp_completed=$(echo "$hp_stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)

        echo -e "--- 检查轮次 $i ---"
        echo -e "  ${YELLOW}默认队列状态:      等待=$default_waiting, 活跃=$default_active, 完成=$default_completed${NC}"
        echo -e "  ${GREEN}高优先级队列状态:  等待=$hp_waiting, 活跃=$hp_active, 完成=$hp_completed${NC}"
        echo ""

        # 检查是否所有任务都已完成
        if [ "$default_waiting" -eq 0 ] && [ "$default_active" -eq 0 ] && [ "$hp_waiting" -eq 0 ] && [ "$hp_active" -eq 0 ]; then
            log_success "所有队列中的任务都已处理完成！"
            break
        fi

        sleep 2
    done

    log_info "(4/4) 显示最终的队列状态..."
    final_default_stats=$(get_queue_stats "default")
    final_hp_stats=$(get_queue_stats "high-priority")
    log_info "最终默认队列状态: $final_default_stats"
    log_info "最终高优先级队列状态: $final_hp_stats"

    log_success "=================================================="
    log_success "            多队列功能测试完成！"
    log_success "=================================================="
    echo ""
    log_info "请检查应用控制台日志，确认来自两个不同队列的任务都被正确处理。"
}

# 主函数
main() {
    check_app
    test_multi_queue
}

main
