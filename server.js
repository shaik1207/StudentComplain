const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bodyParser = require("body-parser");
const path = require("path");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const session = require("express-session");
const bcrypt = require("bcryptjs");

dotenv.config();
const app = express();


const serviceAccount = require("./auth.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const firestore = admin.firestore();
console.log("Firebase Firestore Initialized");


const url =
  "mongodb+srv://sameer:sameer0407@cluster0.3m6v1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const dbName = "vit_complaints";
let db;

(async () => {
  try {
    const client = await MongoClient.connect(url);
    db = client.db(dbName);
    console.log(" Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB Connection Failed", err);
  }
})();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");


app.use(
  session({
    secret: "sameer", 
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

/
app.use((req, res, next) => {
  res.locals.message = req.session.message || null;
  res.locals.error = req.session.error || null;
  delete req.session.message;
  delete req.session.error;
  next();
});


const isLoggedIn = (req, res, next) => {
  if (!req.session.userID) return res.redirect("/login");
  next();
};


app.get("/", async (req, res) => {
  try {
    const loginState = !!req.session.userID;
    const selectedDept = req.query.department || "All";
    const query =
      selectedDept && selectedDept !== "All" ? { department: selectedDept } : {};

    const complaints = await db
      .collection("complaints")
      .find(query)
      .sort({ likes: -1, createdAt: -1 })
      .toArray();

    let username = "Guest";
    if (req.session.userID) {
      const userDoc = await firestore
        .collection("users")
        .doc(req.session.userID)
        .get();
      if (userDoc.exists) username = userDoc.data().name;
    }

    res.render("home", {
      complaints,
      loginState,
      username,
      selectedDept,
      message: res.locals.message,
      error: res.locals.error,
    });
  } catch (error) {
    console.error("❌ Error loading homepage:", error);
    res.status(500).send(`<h2>Error loading homepage: ${error.message}</h2>`);
  }
});


app.get("/signup", (req, res) =>
  res.render("signup", {
    error: res.locals.error || "",
    message: res.locals.message || null,
  })
);

app.post("/signup", async (req, res) => {
  const { firstName, email, password } = req.body;
  console.log("📥 Signup attempt:", email);

  try {
    if (!firstName || !email || !password)
      return res.render("signup", {
        error: "All fields are required.",
        message: null,
      });

    if (password.length < 6)
      return res.render("signup", {
        error: "Password must be at least 6 characters long.",
        message: null,
      });

    const hashedPassword = await bcrypt.hash(password, 10);

   
    const user = await admin.auth().createUser({
      email,
      password,
      displayName: firstName,
    });
    console.log("✅ Firebase user created:", user.uid);

    await firestore.collection("users").doc(user.uid).set({
      name: firstName,
      email,
      password: hashedPassword,
      createdAt: new Date(),
    });

    req.session.userID = user.uid;
    req.session.message = { type: "success", text: "Signup successful! 👋" };
    res.redirect("/");
  } catch (error) {
    console.error("❌ Signup Error:", error);
    const msg =
      error.code === "auth/email-already-exists"
        ? "Email already registered. Please login."
        : "Signup failed. Try again.";
    res.render("signup", { error: msg, message: null });
  }
});


app.get("/login", (req, res) =>
  res.render("login", {
    error: res.locals.error || "",
    message: res.locals.message || null,
  })
);

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("📥 Login attempt:", email);

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    let userDoc = await firestore.collection("users").doc(userRecord.uid).get();

   
    if (!userDoc.exists) {
      console.log("⚠️ No Firestore record found — creating one now.");
      const hashedPassword = await bcrypt.hash(password, 10);
      await firestore.collection("users").doc(userRecord.uid).set({
        name: userRecord.displayName || "User",
        email: userRecord.email,
        password: hashedPassword,
        createdAt: new Date(),
      });
      userDoc = await firestore.collection("users").doc(userRecord.uid).get();
    }

    const userData = userDoc.data();
    const validPassword = await bcrypt.compare(password, userData.password);

    if (!validPassword) {
      req.session.error = "Invalid password. Please try again.";
      return res.redirect("/login");
    }

    req.session.userID = userRecord.uid;
    req.session.message = { type: "success", text: "Login successful! 🎉" };
    console.log(" Login successful:", email);
    res.redirect("/");
  } catch (error) {
    console.error(" Login Error:", error);
    if (error.code === "auth/user-not-found") {
      req.session.error = "No user found with that email. Please sign up.";
    } else {
      req.session.error = "Login failed. Please try again.";
    }
    res.redirect("/login");
  }
});

// 🚪 LOGOUT
app.get("/logout", (req, res) => {
  req.session.message = { type: "success", text: "Logout successful 👋" };
  req.session.destroy(() => {
    console.log("👋 User logged out");
    res.redirect("/");
  });
});


app.get("/submit-form", isLoggedIn, (req, res) =>
  res.render("form", {
    message: res.locals.message || null,
    error: res.locals.error || null,
  })
);

app.post("/submit-complaint", isLoggedIn, async (req, res) => {
  try {
    const complaint = {
      name: req.body.name,
      registerNo: req.body.registerNo || "",
      department: req.body.department,
      typeOfComplaint: req.body.typeOfComplaint,
      complaintText: req.body.complaintText, 
      likes: 0,
      createdAt: new Date(),
    };

    await db.collection("complaints").insertOne(complaint);
    console.log(" Complaint saved:", complaint);

    req.session.message = {
      type: "success",
      text: "Complaint submitted successfully ",
    };
    res.redirect("/");
  } catch (error) {
    console.error(" Complaint submission failed:", error);
    req.session.error = "Error submitting complaint. Please try again.";
    res.redirect("/submit-form");
  }
});


app.post("/liked", isLoggedIn, async (req, res) => {
  try {
    const { like } = req.body;
    await db
      .collection("complaints")
      .updateOne({ _id: new ObjectId(like) }, { $inc: { likes: 1 } });

    req.session.message = { type: "success", text: "You liked a complaint 👍" };
    res.redirect("/");
  } catch (error) {
    console.error(" Error liking complaint:", error);
    req.session.error = "Error liking complaint.";
    res.redirect("/");
  }
});


const PORT = 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running successfully on http://localhost:${PORT}`)
);
