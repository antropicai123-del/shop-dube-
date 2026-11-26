-- Safe to run many times: creates tables only if they do not exist yet.
CREATE TABLE IF NOT EXISTS shop_settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS operators (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, role TEXT DEFAULT 'staff', is_active INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, telegram_username TEXT,
  telegram_chat_id TEXT, notes TEXT, is_active INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, unit TEXT, default_price NUMERIC(12,2), is_active INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dube_transactions (
  id SERIAL PRIMARY KEY, customer_id INT NOT NULL REFERENCES customers(id),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE, notes TEXT,
  total_amount NUMERIC(12,2) NOT NULL, operator_id INT, is_void INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dube_items (
  id SERIAL PRIMARY KEY, transaction_id INT NOT NULL REFERENCES dube_transactions(id),
  item_name TEXT NOT NULL, unit TEXT, quantity NUMERIC(12,2) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL, line_total NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS dube_payments (
  id SERIAL PRIMARY KEY, customer_id INT NOT NULL REFERENCES customers(id),
  transaction_id INT REFERENCES dube_transactions(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), payment_method TEXT DEFAULT 'cash',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE, operator_id INT, is_void INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS balitina_sales (
  id SERIAL PRIMARY KEY, sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), is_void INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS household_expenses (
  id SERIAL PRIMARY KEY, expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), description TEXT, is_void INT NOT NULL DEFAULT 0
);
