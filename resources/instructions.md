
# RDB LOG Explorer

This project goal is to create a Sales Transaction Explorer using data from a PostgreSQL database, this tool will be a web-app connected to a light backend to perform queries on a postgresql database. 

For now, use the following endpoint to perform DB query, do selects only and never edit the data, perform some example queries to get some data examples.

```bash
curl --location 'http://demo.elvispos.com:7392/api/db-operations/remote-lookup' \
--data '{
    "request": {
        "command": 1003,
        "query": "SELECT * FROM public.rdb_log LIMIT 1"
    }
}'
```

### Project Requirements

- Use bun.js as runtime
- Add Makefile to project for devs
- Use typescript
- a neat, simple and clean UI made with tailwindcss
- use vitejs for building

### Features

- sort, filter and list transactions by date, amount, store, terminal, operator
- search through the transactions by article name, loyalty number, others
- inspect transactions details