# Data Engineering (DE) Integrated Project Submission
**Course:** Data Engineering (DE)  
**Project Title:** DSA Practice Platform — Multi-Client Distributed System  
**Team Member Responsible for Database & Engineering:** Person 2  
**Database System:** PostgreSQL 16 (Server) & SQLite 3 WAL (Local Offline Client)  

---

## Deliverables Index

This folder contains the complete, formal academic submission artifacts for the Data Engineering component of the integrated project, adhering strictly to the DE evaluation guidelines:

| File | Section | Description |
| :--- | :--- | :--- |
| [`01_database_selection.md`](./01_database_selection.md) | **2.A** | Comprehensive Database Selection & Justification (PostgreSQL vs. MongoDB, ACID requirements, and data nature). |
| [`02_er_diagram_and_modelling.md`](./02_er_diagram_and_modelling.md) | **2.B** | Entity-Relationship (ER) Modeling, Entities, Attributes, Keys (PK/FK), Cardinality (1:1, 1:N, N:M), and Mermaid Diagram. |
| [`03_normalization.md`](./03_normalization.md) | **2.C** | Complete Normalization documentation (1NF, 2NF, 3NF transformations, functional dependencies, anomaly analysis, and intentional denormalization). |
| [`04_database_schema.sql`](./04_database_schema.sql) | **2.D / 3** | Complete consolidated PostgreSQL DDL schema with data types, constraints, indexes, triggers, roles, and materialized view. |
| [`05_sample_records.md`](./05_sample_records.md) | **2.D / 3** | Real sample data records across all 11 tables illustrating database population and state. |
| [`06_queries_and_execution.md`](./06_queries_and_execution.md) | **2.E / 3** | 10 Project-Specific complex SQL queries addressing actual application features with runtime outputs and `EXPLAIN (ANALYZE, BUFFERS)` plans. |
| [`07_backend_integration.md`](./07_backend_integration.md) | **2.F / 3** | Evidence of backend application integration: connection pool sizing, transactional guarantees, repository pattern, and offline-sync adapter. |
| [`08_architecture_and_performance.md`](./08_architecture_and_performance.md) | **2.G / 3** | Data integrity, indexing strategy, Materialized View refresh, Keyset vs. Offset pagination benchmarks, RBAC security, and scaling analysis. |

---

## Executive Summary of Database Architecture

The **DSA Practice Platform** utilizes a **hybrid relational and offline-distributed data architecture**:
1. **Server Core**: PostgreSQL 16 serves as the primary source of truth, enforcing strict ACID transactional guarantees for code submission evaluation, user progression, and audit trails.
2. **Offline-First Resilience**: Client applications (CLI, Desktop Electron, Mobile React Native) maintain an embedded SQLite database configured in **Write-Ahead Logging (WAL)** mode.
3. **Distributed Synchronization**: Synchronized through an **Operation Log (OpLog)** pattern driven by **Hybrid Logical Clocks (HLC)** to ensure causality and deterministic conflict resolution without clock drift anomalies.
4. **Extreme Performance Tuning**: Built-in Materialized View (`mv_leaderboard`) providing a **6,900× query speedup** (220.64ms down to 0.02ms), Keyset cursor pagination achieving **1,112× faster execution** on deep pages over `OFFSET`, and covering B-Tree indexes delivering zero-heap **Index-Only Scans**.
