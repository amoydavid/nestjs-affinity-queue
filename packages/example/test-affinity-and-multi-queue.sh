#!/bin/bash

# 多队列与亲和性并发测试脚本
# 1. 测试默认队列和高优先级队列的独立运行
# 2. 测试每个队列内部的亲和性调度和并行处理能力

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

    # 使用静默模式，只在失败时显示错误
    curl -s -f -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "{
            \"type\": \"$task_type\",
            \"identifyTag\": \"$identify_tag\",
            \"payload\": $payload
        }" > /dev/null || log_error "向 $queue_name 队列添加任务失败: $identify_tag"
}

# 主测试函数
test_affinity_and_multi_queue() {
    log_info "============================================================"
    log_info "        开始测试多队列、亲和性与并行处理能力"
    log_info "============================================================"

    # --- Phase 1: 添加任务 ---
    log_info "(1/4) 批量添加任务到两个队列中..."
    
    # 为默认队列添加两组不同 identifyTag 的任务
    log_info "  -> 向默认队列添加 5 个 'company-A' 任务 (邮件)"
    for i in {1..5}; do add_task "default" "company-A" "send-email" "{\"content\": \"Default task A-$i\"}"; done
    
    log_info "  -> 向默认队列添加 5 个 'company-B' 任务 (发票)"
    for i in {1..5}; do add_task "default" "company-B" "generate-invoice" "{\"content\": \"Default task B-$i\"}"; done

    # 为高优先级队列添加两组不同 identifyTag 的任务
    log_info "  -> 向高优先级队列添加 4 个 'vip-C' 任务 (数据处理)"
    for i in {1..4}; do add_task "high-priority" "vip-C" "process-data" "{\"content\": \"HP task C-$i\"}"; done
    
    log_info "  -> 向高优先级队列添加 4 个 'vip-D' 任务 (邮件)"
    for i in {1..4}; do add_task "high-priority" "vip-D" "send-email" "{\"content\": \"HP task D-$i\"}"; done
    
    log_success "所有任务已添加完毕。"
    echo ""

    # --- Phase 2: 解释观察要点 ---
    log_info "(2/4) 开始监控队列状态..."
    log_info "      请重点观察每个队列的 ${YELLOW}active${NC} 任务数"
    log_info "      > 亲和性: 同一个tag的任务(如company-A)会由一个Worker顺序处理。"
    log_info "      > 并行性: 不同tag的任务(如company-A和company-B)会由不同Worker并行处理。"
    log_info "      > 预期结果: 在Worker数量足够时, active 数应约等于并发的tag数 (本例中为2)。"
    echo ""

    # --- Phase 3: 循环监控 ---
    for i in {1..30}; do
        default_stats=$(get_queue_stats "default")
        hp_stats=$(get_queue_stats "high-priority")

        default_waiting=$(echo "$default_stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        default_active=$(echo "$default_stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        default_completed=$(echo "$default_stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)

        hp_waiting=$(echo "$hp_stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
        hp_active=$(echo "$hp_stats" | grep -o '"active":[0-9]*' | cut -d':' -f2)
        hp_completed=$(echo "$hp_stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)

        echo -e "--- 检查轮次 $i ---"
        echo -e "  ${YELLOW}默认队列:      等待=$default_waiting, 活跃=$default_active, 完成=$default_completed${NC}"
        echo -e "  ${GREEN}高优先级队列:  等待=$hp_waiting, 活跃=$hp_active, 完成=$hp_completed${NC}"
        echo ""

        # 检查是否所有任务都已处理完成
        if [[ "$default_waiting" -eq 0 && "$default_active" -eq 0 && "$hp_waiting" -eq 0 && "$hp_active" -eq 0 ]]; then
            log_success "所有队列中的任务似乎都已处理完成！"
            break
        fi

        sleep 2
    done

    # --- Phase 4: 最终结果 ---
    log_info "(4/4) 显示最终的队列状态..."
    final_default_stats=$(get_queue_stats "default")
    final_hp_stats=$(get_queue_stats "high-priority")
    log_info "最终默认队列状态: $final_default_stats"
    log_info "最终高优先级队列状态: $final_hp_stats"

    log_success "============================================================"
    log_success "            亲和性与多队列并发测试完成！"
    log_success "============================================================"
}

# 主函数
main() {
    check_app
    test_affinity_and_multi_queue
}

main
