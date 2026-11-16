
import express from "express";
import pg from "pg";
import cors from "cors";
import bcrypt from "bcrypt";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const app = express();
const PORT = process.env.PORT || 8000;
const isProduction = process.env.NODE_ENV === "production";

// ========================================
// 1. 환경변수 검증
// ========================================

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 환경변수가 필요합니다.");
}

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET 환경변수가 필요합니다.");
}

if (isProduction && !process.env.CLIENT_URL) {
  throw new Error("CLIENT_URL 환경변수가 필요합니다.");
}

// ========================================
// 2. PostgreSQL 연결
// ========================================

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
    }
  : {
      host: "localhost",
      port: 5432,
      user: "jsuser",
      password: "pwjs",
      database: "tsdb",
    };

// 세션 저장소와 일반 API에서 함께 사용할 Pool
const db = new pg.Pool(dbConfig);

try {
  const client = await db.connect();
  console.log("PostgreSQL 연결 성공!");
  client.release();
} catch (err) {
  console.error("PostgreSQL 연결 실패!", err);
  process.exit(1);
}

// ========================================
// 3. Render 프록시 설정
// ========================================

if (isProduction) {
  app.set("trust proxy", 1);
}

// ========================================
// 4. CORS 설정
// ========================================

// CLIENT_URL에 여러 주소를 쉼표로 구분해 등록 가능
const allowedOrigins = [
  ...(!isProduction ? ["http://localhost:5173"] : []),
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean),
];

console.log("CORS 허용 주소:", allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("CORS 허용되지 않은 출처"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ========================================
// 5. 요청 본문 파싱
// ========================================

app.use(express.json({ limit: "1mb" }));

// ========================================
// 6. 세션 설정
// ========================================

// PostgreSQL에 세션 저장
const PgSession = connectPgSimple(session);

const sessionStore = new PgSession({
  pool: db,
  tableName: "session",
  createTableIfMissing: true,
});

const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 1000 * 60 * 60,
  path: "/",
};

app.use(
  session({
    name: "connect.sid",
    store: sessionStore,
    secret:
      process.env.SESSION_SECRET ||
      "local-development-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookieOptions,
  }),
);

// ========================================
// 7. 인증 미들웨어
// ========================================

// 로그인 여부 확인
const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({
      message: "로그인이 필요합니다.",
    });
  }

  next();
};

// 관리자 여부 확인
const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({
      message: "로그인이 필요합니다.",
    });
  }

  if (req.session.user.role !== "admin") {
    return res.status(403).json({
      message: "관리자만 사용할 수 있습니다.",
    });
  }

  next();
};

// ========================================
// 8. 기본 API
// ========================================

app.get("/", (req, res) => {
  res.send("<h1>쇼핑몰 서버 API 개발</h1>");
});

// Render 상태 확인용
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (err) {
    console.error("Health check 오류:", err);

    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

// ========================================
// 9. 상품 API
// ========================================

// 상품 목록 조회
app.get("/api/products", async (req, res) => {
  const sql = "SELECT * FROM products";

  try {
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("상품 목록 조회 오류:", err);

    res.status(500).json({
      message: "상품 목록 조회 오류",
    });
  }
});

// 상품 1건 조회
app.get("/api/products/:id", async (req, res) => {
  const pid = req.params.id;
  const sql = "SELECT * FROM products WHERE id = $1";

  try {
    const result = await db.query(sql, [pid]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "상품을 찾을 수 없습니다.",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("상품 조회 오류:", err);

    res.status(500).json({
      message: "상품 조회 오류",
    });
  }
});

// 상품 등록 - 관리자
app.post("/api/products", requireAdmin, async (req, res) => {
  const { pName, category, price, description, image } = req.body;

  if (!pName || !category || price == null) {
    return res.status(400).json({
      message: "상품명, 카테고리, 가격은 필수입니다.",
    });
  }

  const sql = `
    INSERT INTO products
      (p_name, category, price, description, image)
    VALUES ($1, $2, $3, $4, $5)
  `;

  try {
    await db.query(sql, [
      pName,
      category,
      price,
      description ?? null,
      image ?? null,
    ]);

    res.json({
      message: "상품 등록 완료!",
    });
  } catch (err) {
    console.error("상품 등록 오류:", err);

    res.status(500).json({
      message: "상품 등록 오류",
    });
  }
});

// 상품 삭제 - 관리자
app.delete("/api/products/:id", requireAdmin, async (req, res) => {
  const pid = req.params.id;
  const sql = "DELETE FROM products WHERE id = $1 RETURNING id";

  try {
    const result = await db.query(sql, [pid]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "상품을 찾을 수 없습니다.",
      });
    }

    res.json({
      message: "상품 삭제 완료!",
    });
  } catch (err) {
    console.error("상품 삭제 오류:", err);

    res.status(500).json({
      message: "상품 삭제 오류",
    });
  }
});

// 상품 수정 - 관리자
app.put("/api/products/:id", requireAdmin, async (req, res) => {
  const pid = req.params.id;
  const { pName, category, price, description, image } = req.body;

  if (!pName || !category || price == null) {
    return res.status(400).json({
      message: "상품명, 카테고리, 가격은 필수입니다.",
    });
  }

  const sql = `
    UPDATE products
    SET p_name = $1,
        category = $2,
        price = $3,
        description = $4,
        image = $5
    WHERE id = $6
    RETURNING id
  `;

  try {
    const result = await db.query(sql, [
      pName,
      category,
      price,
      description ?? null,
      image ?? null,
      pid,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "상품을 찾을 수 없습니다.",
      });
    }

    res.json({
      message: "상품 수정 완료!",
    });
  } catch (err) {
    console.error("상품 수정 오류:", err);

    res.status(500).json({
      message: "상품 수정 오류",
    });
  }
});

// ========================================
// 10. 회원 API
// ========================================

// 회원 목록 - 관리자 전용
app.get("/api/users", requireAdmin, async (req, res) => {
  const sql = `
    SELECT id, username, name, email, role, created_at
    FROM users
  `;

  try {
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("회원 목록 조회 오류:", err);

    res.status(500).json({
      message: "회원 목록 조회 오류",
    });
  }
});

// 회원가입
app.post("/api/users", async (req, res) => {
  const { username, password, name, email } = req.body;

  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    password.length < 8 ||
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim()
  ) {
    return res.status(400).json({
      message: "입력값을 확인해주세요. 비밀번호는 8자 이상이어야 합니다.",
    });
  }

  const sql = `
    INSERT INTO users
      (username, password, name, email)
    VALUES ($1, $2, $3, $4)
  `;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(sql, [
      username.trim(),
      hashedPassword,
      name.trim(),
      email.trim(),
    ]);

    res.json({
      message: "회원가입 완료!",
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        message: "이미 사용 중인 아이디 또는 이메일입니다.",
      });
    }

    console.error("회원가입 오류:", err);

    res.status(500).json({
      message: "회원가입 중 오류가 발생했습니다.",
    });
  }
});

// ========================================
// 11. 로그인
// ========================================

app.post("/api/users/login", async (req, res, next) => {
  const { username, password } = req.body;

  if (
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      message: "아이디와 비밀번호를 입력해주세요.",
    });
  }

  const sql = "SELECT * FROM users WHERE username = $1";

  try {
    const result = await db.query(sql, [username]);
    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(password, user.password))
    ) {
      return res.status(401).json({
        message: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // 비밀번호 제외
    const { password: _, ...userInfo } = user;

    // 세션 고정 공격 방지를 위해 세션 ID 재생성
    req.session.regenerate((err) => {
      if (err) {
        return next(err);
      }

      req.session.user = userInfo;

      req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }

        res.json({
          message: "로그인 성공",
          user: userInfo,
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

// ========================================
// 12. 로그인 확인
// ========================================

app.get("/api/users/me", requireLogin, (req, res) => {
  res.json(req.session.user);
});

// ========================================
// 13. 로그아웃
// ========================================

app.post("/api/users/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }

    res.clearCookie("connect.sid", {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    });

    res.json({
      message: "로그아웃 완료",
    });
  });
});

// ========================================
// 14. 회원 정보 수정
// ========================================

app.put("/api/users/:id", requireLogin, async (req, res) => {
  const uid = Number(req.params.id);
  const { name, email } = req.body;

  if (req.session.user.id !== uid) {
    return res.status(403).json({
      message: "본인 정보만 수정할 수 있습니다.",
    });
  }

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim()
  ) {
    return res.status(400).json({
      message: "이름과 이메일을 입력해주세요.",
    });
  }

  const sql = `
    UPDATE users
    SET name = $1, email = $2
    WHERE id = $3
    RETURNING id, username, name, email, role, created_at
  `;

  try {
    const result = await db.query(sql, [
      name.trim(),
      email.trim(),
      uid,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "회원을 찾을 수 없습니다.",
      });
    }

    const updatedUser = result.rows[0];

    req.session.user = updatedUser;

    req.session.save((err) => {
      if (err) {
        console.error("세션 저장 오류:", err);

        return res.status(500).json({
          message: "회원 정보 저장 중 오류가 발생했습니다.",
        });
      }

      res.json(updatedUser);
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        message: "이미 사용 중인 이메일입니다.",
      });
    }

    console.error("회원 수정 오류:", err);

    res.status(500).json({
      message: "회원 수정 오류",
    });
  }
});

// ========================================
// 15. 404 처리
// ========================================

app.use((req, res) => {
  res.status(404).json({
    message: "존재하지 않는 API입니다.",
  });
});

// ========================================
// 16. 전역 오류 처리
// ========================================

app.use((err, req, res, next) => {
  console.error("서버 오류:", err);

  if (err.message === "CORS 허용되지 않은 출처") {
    return res.status(403).json({
      message: "허용되지 않은 출처입니다.",
    });
  }

  res.status(500).json({
    message: "서버 내부 오류가 발생했습니다.",
  });
});

// ========================================
// 17. 서버 실행
// ========================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`서버 실행 중 - PORT: ${PORT}`);
  console.log(`환경: ${process.env.NODE_ENV || "development"}`);
});
