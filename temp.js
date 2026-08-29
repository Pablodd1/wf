const fs = require("fs"); let sql = fs.readFileSync("v4.sql", "utf8"); sql = sql.replace(/--.*$/gm, "").replace(/^\s*[\r\n]/gm, ""); fs.writeFileSync("v4_clean.sql", sql);
