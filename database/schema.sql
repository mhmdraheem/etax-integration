CREATE DATABASE IF NOT EXISTS receipts_system
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE receipts_system;

CREATE TABLE IF NOT EXISTS batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_number VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  receipt_count INT UNSIGNED NOT NULL DEFAULT 0,
  submissionID VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  response JSON NULL,
  request_json JSON NOT NULL,
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batches_batch_number (batch_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  receipt_number VARCHAR(128) NOT NULL,
  document_type VARCHAR(16) NOT NULL,
  source_invoice VARCHAR(128) NULL,
  source_doc VARCHAR(128) NULL,
  uuid CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'valid',
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  request_json JSON NOT NULL,
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipts_uuid (uuid),
  KEY idx_receipts_receipt_number (receipt_number),
  KEY idx_receipts_source_doc (source_doc),
  KEY idx_receipts_document_type (document_type),
  CONSTRAINT fk_receipts_batch
    FOREIGN KEY (batch_id) REFERENCES batches(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
