#!/bin/bash

# NestJS Affinity Queue 测试套件
# 测试所有核心功能

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
BASE_URL="http://localhost:3000"
APP_PID=""

# 日志函数
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

# 清理函数
cleanup() {
    if [ ! -z "$APP_PID" ]; then
        log_info "停止应用 (PID: $APP_PID)"
        kill $APP_PID 2>/dev/null || true
    fi
}

# 设置退出时清理
trap cleanup EXIT

# 检查应用是否运行
check_app_running() {
    if curl -s "$BASE_URL" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# 等待应用启动
wait_for_app() {
    log_info "等待应用启动..."
    for i in {1..30}; do
        if check_app_running; then
            log_success "应用已启动"
            return 0
        fi
        sleep 1
    done
    log_error "应用启动超时"
    return 1
}

# 测试健康检查
test_health_check() {
    log_info "测试健康检查..."
    response=$(curl -s "$BASE_URL")
    if [[ "$response" == *"NestJS Affinity Queue 示例应用运行中"* ]]; then
        log_success "健康检查通过"
    else
        log_error "健康检查失败: $response"
        return 1
    fi
}

# 测试队列状态
test_queue_stats() {
    log_info "测试队列状态查询..."
    response=$(curl -s "$BASE_URL/queue/stats")
    if echo "$response" | grep -q '"waiting"'; then
        log_success "队列状态查询通过"
        echo "当前队列状态: $response"
    else
        log_error "队列状态查询失败: $response"
        return 1
    fi
}

# 测试单任务提交
test_single_task() {
    log_info "测试单任务提交..."
    response=$(curl -s -X POST "$BASE_URL/tasks" \
        -H "Content-Type: application/json" \
        -d '{
            "type": "send-email",
            "identifyTag": "test-single",
            "payload": {
                "to": "test@example.com",
                "subject": "单任务测试"
            }
        }')
    
    if echo "$response" | grep -q '"message":"任务已添加到队列"'; then
        log_success "单任务提交通过"
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        echo "任务ID: $job_id"
    else
        log_error "单任务提交失败: $response"
        return 1
    fi
}

# 测试亲和性调度
test_affinity_scheduling() {
    log_info "测试亲和性调度..."
    
    # 添加第一个任务
    response1=$(curl -s -X POST "$BASE_URL/tasks" \
        -H "Content-Type: application/json" \
        -d '{
            "type": "send-email",
            "identifyTag": "affinity-test",
            "payload": {
                "to": "user1@affinity.com",
                "subject": "亲和性测试1"
            }
        }')
    
    job_id1=$(echo "$response1" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
    log_info "第一个任务ID: $job_id1"
    
    # 等待一下让任务被分配
    sleep 2
    
    # 检查队列状态
    stats_before=$(curl -s "$BASE_URL/queue/stats")
    waiting_before=$(echo "$stats_before" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    
    # 添加相同identifyTag的任务
    for i in {2..4}; do
        response=$(curl -s -X POST "$BASE_URL/tasks" \
            -H "Content-Type: application/json" \
            -d "{
                \"type\": \"send-email\",
                \"identifyTag\": \"affinity-test\",
                \"payload\": {
                    \"to\": \"user$i@affinity.com\",
                    \"subject\": \"亲和性测试$i\"
                }
            }")
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        log_info "任务$i ID: $job_id"
    done
    
    # 等待一下
    sleep 2
    
    # 检查队列状态
    stats_after=$(curl -s "$BASE_URL/queue/stats")
    waiting_after=$(echo "$stats_after" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    
    if [ "$waiting_after" -gt "$waiting_before" ]; then
        log_success "亲和性调度测试通过 - 相同identifyTag的任务在等待"
        echo "等待任务数: $waiting_after"
    else
        log_warning "亲和性调度测试 - 任务可能已被处理"
    fi
}

# 测试并行处理
test_parallel_processing() {
    log_info "测试并行处理..."
    
    # 添加不同identifyTag的任务
    for i in {1..3}; do
        response=$(curl -s -X POST "$BASE_URL/tasks" \
            -H "Content-Type: application/json" \
            -d "{
                \"type\": \"generate-invoice\",
                \"identifyTag\": \"parallel-test-$i\",
                \"payload\": {
                    \"amount\": $((1000 + $i * 100)),
                    \"description\": \"并行测试$i\"
                }
            }")
        job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        log_info "并行任务$i ID: $job_id"
    done
    
    # 等待处理
    sleep 3
    
    # 检查队列状态
    stats=$(curl -s "$BASE_URL/queue/stats")
    waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    
    if [ "$waiting" -eq 0 ]; then
        log_success "并行处理测试通过 - 所有任务已处理"
    else
        log_warning "并行处理测试 - 还有 $waiting 个任务在等待"
    fi
}

# 测试批量任务
test_batch_tasks() {
    log_info "测试批量任务..."
    
    response=$(curl -s -X POST "$BASE_URL/tasks/batch?count=6&companies=2")
    
    if echo "$response" | grep -q '"message":"成功添加'; then
        log_success "批量任务提交通过"
        job_ids=$(echo "$response" | grep -o '"jobIds":\[[^]]*\]' | grep -o '"[^"]*"' | tr -d '"' | tr '\n' ' ')
        echo "批量任务ID: $job_ids"
    else
        log_error "批量任务提交失败: $response"
        return 1
    fi
    
    # 等待处理
    sleep 5
    
    # 检查队列状态
    stats=$(curl -s "$BASE_URL/queue/stats")
    waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    
    if [ "$waiting" -eq 0 ]; then
        log_success "批量任务处理完成"
    else
        log_warning "批量任务还有 $waiting 个在等待"
    fi
}

# 测试不同任务类型
test_task_types() {
    log_info "测试不同任务类型..."
    
    # 测试邮件发送
    response1=$(curl -s -X POST "$BASE_URL/tasks" \
        -H "Content-Type: application/json" \
        -d '{
            "type": "send-email",
            "identifyTag": "type-test",
            "payload": {
                "to": "email@test.com",
                "subject": "邮件类型测试"
            }
        }')
    
    # 测试发票生成
    response2=$(curl -s -X POST "$BASE_URL/tasks" \
        -H "Content-Type: application/json" \
        -d '{
            "type": "generate-invoice",
            "identifyTag": "type-test",
            "payload": {
                "amount": 2000,
                "description": "发票类型测试"
            }
        }')
    
    # 测试数据处理
    response3=$(curl -s -X POST "$BASE_URL/tasks" \
        -H "Content-Type: application/json" \
        -d '{
            "type": "process-data",
            "identifyTag": "type-test",
            "payload": {
                "recordCount": 100,
                "operation": "数据类型测试"
            }
        }')
    
    if echo "$response1" | grep -q '"message":"任务已添加到队列"' && \
       echo "$response2" | grep -q '"message":"任务已添加到队列"' && \
       echo "$response3" | grep -q '"message":"任务已添加到队列"'; then
        log_success "所有任务类型测试通过"
    else
        log_error "任务类型测试失败"
        return 1
    fi
}

# 测试压力测试
test_stress() {
    log_info "测试压力测试..."
    
    # 添加多个不同identifyTag的任务
    for i in {1..10}; do
        response=$(curl -s -X POST "$BASE_URL/tasks" \
            -H "Content-Type: application/json" \
            -d "{
                \"type\": \"send-email\",
                \"identifyTag\": \"stress-test-$i\",
                \"payload\": {
                    \"to\": \"user$i@stress.com\",
                    \"subject\": \"压力测试$i\"
                }
            }")
        
        if ! echo "$response" | grep -q '"message":"任务已添加到队列"'; then
            log_error "压力测试失败: $response"
            return 1
        fi
    done
    
    log_success "压力测试通过 - 成功添加10个任务"
    
    # 等待处理
    sleep 10
    
    # 检查最终状态
    stats=$(curl -s "$BASE_URL/queue/stats")
    waiting=$(echo "$stats" | grep -o '"waiting":[0-9]*' | cut -d':' -f2)
    completed=$(echo "$stats" | grep -o '"completed":[0-9]*' | cut -d':' -f2)
    
    log_info "压力测试结果 - 等待: $waiting, 完成: $completed"
}

# 主测试函数
run_tests() {
    log_info "开始运行 NestJS Affinity Queue 测试套件"
    
    # 检查应用是否运行
    if ! check_app_running; then
        log_error "应用未运行，请先启动应用"
        return 1
    fi
    
    # 运行所有测试
    test_health_check
    test_queue_stats
    test_single_task
    test_affinity_scheduling
    test_parallel_processing
    test_batch_tasks
    test_task_types
    test_stress
    
    log_success "所有测试完成！"
}

# 运行测试
run_tests 