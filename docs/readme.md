### node版本切换之后，需要重新编译数据库

    cd server && npm rebuild better-sqlite3

### 前端启动命令

    cd promptflow && npm run dev
    
    npm run frontend

### 灵犀助手启动命令

    cd promptflow && ./bin/linxi_ai_assistant_server

### 语义识别启动命令

    开发模式：cd promptflow/linxi_skill_server && python3.9 app.py
    生产模式：gunicorn -w 4 -b 127.0.0.1:5001 app:app（app:app 对应的是app.py里面有一个实例app）
    生产模式：uvicorn app:app --host 127.0.0.1 --port 5001 --workers 4（原生支持异步）

    需要用这个：
    gunicorn -w 4 -b 127.0.0.1:5001 --timeout 0 app:app
    
    生产部署：
    gunicorn -k eventlet -w 4 -b 127.0.0.1:5001 app:app

### 登录用户

    admin/admin123456
    cwy/19940620cwy

### 杀掉进程

    ps aux | grep cmdb | grep -v grep | awk '{print $2}' | xargs kill -9 && go run .
    ps aux | grep npm | grep -v grep | awk '{print $2}' | xargs kill -9 && npm run dev


### 图标
    https://icons.bootcss.com/

### Swagger
    http://localhost:9080/swagger/index.html#/




