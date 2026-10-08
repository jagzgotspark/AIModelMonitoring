"""Generate the demo datasets in this folder.

Run from the repo root:  python sample_data/generate_samples.py
Seeded, so it always produces the same files.

Three scenarios, each with a training file and "incoming data" batches for the drift page:
  * Customer churn      (classification) - target column: churned (Yes / No)
  * House prices        (regression)     - target column: price_lakhs
  * Student performance (classification) - target column: result (Pass / Fail)
The batches have no target column, like real production data.
"""

from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).parent
rng = np.random.default_rng(2026)


# ---------------------------------------------------------------- churn

CONTRACTS = ["Month-to-month", "One year", "Two year"]
INTERNET = ["Fiber optic", "DSL", "No internet"]
PAYMENTS = ["Electronic check", "Credit card", "Bank transfer", "Mailed check"]


def churn_customers(n, *, price_factor=1.0, tenure_scale=1.0, tickets_extra=0.0,
                    payments=PAYMENTS, payment_p=(0.35, 0.25, 0.25, 0.15), charges_missing=0.01):
    contract = rng.choice(CONTRACTS, n, p=[0.55, 0.25, 0.20])
    internet = rng.choice(INTERNET, n, p=[0.45, 0.40, 0.15])
    tenure = np.clip(rng.gamma(2.0, 14.0 * tenure_scale, n), 1, 72).round().astype(int)
    # Longer contracts belong to longer-standing customers.
    tenure = np.where(contract == "Two year", np.clip(tenure + 18, 1, 72), tenure)

    base = np.select([internet == "Fiber optic", internet == "DSL"], [85.0, 60.0], 25.0)
    monthly = (base + rng.normal(0, 12, n)).clip(18, 140) * price_factor

    df = pd.DataFrame({
        "age": rng.integers(18, 76, n),
        "tenure_months": tenure,
        "monthly_charges": monthly.round(2),
        "contract_type": contract,
        "internet_service": internet,
        "payment_method": rng.choice(payments, n, p=payment_p),
        "tech_support": rng.choice(["Yes", "No"], n, p=[0.4, 0.6]),
        "support_tickets": rng.poisson(1.2 + tickets_extra, n),
    })
    df.loc[rng.random(n) < charges_missing, "monthly_charges"] = np.nan
    return df


def churn_labels(df):
    # Hidden "true" rule the models have to learn.
    logit = (
        -1.2
        + 1.6 * (df.contract_type == "Month-to-month")
        - 0.9 * (df.contract_type == "Two year")
        - 0.045 * df.tenure_months
        + 0.022 * (df.monthly_charges.fillna(70) - 70)
        + 0.6 * (df.internet_service == "Fiber optic")
        + 0.5 * (df.payment_method == "Electronic check")
        - 0.6 * (df.tech_support == "Yes")
        + 0.35 * df.support_tickets
    )
    prob = 1 / (1 + np.exp(-logit))
    return np.where(rng.random(len(df)) < prob, "Yes", "No")


train = churn_customers(2000)
train["churned"] = churn_labels(train)
train.to_csv(OUT / "customer_churn_train.csv", index=False)

# Batch 1: same population as training -> no drift.
churn_customers(500).to_csv(OUT / "churn_batch1_normal_month.csv", index=False)

# Batch 2: company raised prices by 25% -> only monthly_charges drifts.
churn_customers(500, price_factor=1.25).to_csv(OUT / "churn_batch2_price_increase.csv", index=False)

# Batch 3: a sign-up campaign brought many brand-new customers paying with a new
# "UPI" option, with more support tickets and a billing bug blanking some charges.
churn_customers(
    500,
    tenure_scale=0.35,
    tickets_extra=1.5,
    payments=PAYMENTS + ["UPI"],
    payment_p=(0.20, 0.15, 0.10, 0.05, 0.50),
    charges_missing=0.20,
).to_csv(OUT / "churn_batch3_major_shift.csv", index=False)


# ---------------------------------------------------------------- house prices

LOCATIONS = ["City Centre", "Suburb", "Outskirts"]
CONDITIONS = ["Poor", "Fair", "Good", "Excellent"]


def houses(n, *, locations=LOCATIONS, location_p=(0.25, 0.5, 0.25), area_scale=1.0, age_shift=0.0):
    location = rng.choice(locations, n, p=location_p)
    bedrooms = rng.choice([1, 2, 3, 4, 5], n, p=[0.1, 0.3, 0.35, 0.18, 0.07])
    area = (380 * bedrooms + rng.normal(250, 150, n)).clip(350, 4000) * area_scale
    distance = np.select(
        [location == "City Centre", location == "Suburb", location == "Outskirts"],
        [rng.uniform(0.5, 5, n), rng.uniform(5, 15, n), rng.uniform(15, 35, n)],
        rng.uniform(25, 45, n),  # any new location is further out
    )
    return pd.DataFrame({
        "area_sqft": area.round().astype(int),
        "bedrooms": bedrooms,
        "bathrooms": np.clip(bedrooms - rng.integers(0, 2, n), 1, 4),
        "house_age_years": np.clip(rng.gamma(2.0, 7.0, n) + age_shift, 0, 60).round().astype(int),
        "distance_to_city_km": distance.round(1),
        "location": location,
        "condition": rng.choice(CONDITIONS, n, p=[0.08, 0.27, 0.45, 0.20]),
        "has_parking": rng.choice(["Yes", "No"], n, p=[0.65, 0.35]),
    })


def house_prices(df):
    # Price in lakhs (1 lakh = 100,000 INR).
    location_premium = df.location.map({"City Centre": 1.45, "Suburb": 1.0, "Outskirts": 0.75}).fillna(0.7)
    condition_factor = df.condition.map({"Poor": 0.8, "Fair": 0.92, "Good": 1.0, "Excellent": 1.15})
    price = (
        0.055 * df.area_sqft * location_premium * condition_factor
        + 6 * df.bathrooms
        + 8 * (df.has_parking == "Yes")
        - 0.6 * df.house_age_years
        - 0.4 * df.distance_to_city_km
        + rng.normal(0, 8, len(df))
    )
    return price.clip(lower=12).round(2)


house_train = houses(1500)
house_train["price_lakhs"] = house_prices(house_train)
house_train.to_csv(OUT / "house_prices_train.csv", index=False)

# Batch 1: same market as training -> no drift.
houses(400).to_csv(OUT / "house_batch1_normal.csv", index=False)

# Batch 2: a new township opens far from the city with large, brand-new homes.
houses(
    400,
    locations=LOCATIONS + ["New Township"],
    location_p=(0.15, 0.30, 0.15, 0.40),
    area_scale=1.3,
    age_shift=-8,
).to_csv(OUT / "house_batch2_new_township.csv", index=False)

# ---------------------------------------------------------------- student performance
# (Generated after the other scenarios so their files stay identical.)

PARENT_EDUCATION = ["School", "Graduate", "Postgraduate"]


def students(n, *, modes=("Offline", "Hybrid"), mode_p=(0.7, 0.3), attendance_shift=0.0,
             study_scale=1.0, assignments_shift=0.0):
    return pd.DataFrame({
        "study_hours_per_week": (rng.gamma(4.0, 3.0, n) * study_scale).clip(0, 40).round(1),
        "attendance_pct": (rng.normal(82, 10, n) + attendance_shift).clip(30, 100).round(1),
        "previous_exam_score": rng.normal(65, 14, n).clip(20, 100).round(),
        "assignments_submitted": (rng.binomial(10, 0.8, n) + assignments_shift).clip(0, 10).round().astype(int),
        "sleep_hours": rng.normal(7, 1.1, n).clip(4, 10).round(1),
        "class_mode": rng.choice(list(modes), n, p=list(mode_p)),
        "extracurricular": rng.choice(["Yes", "No"], n, p=[0.45, 0.55]),
        "parent_education": rng.choice(PARENT_EDUCATION, n, p=[0.4, 0.4, 0.2]),
    })


def student_results(df):
    # Hidden "true" rule: study time, attendance and past scores matter most.
    logit = (
        -13.5
        + 0.15 * df.study_hours_per_week
        + 0.07 * df.attendance_pct
        + 0.07 * df.previous_exam_score
        + 0.25 * df.assignments_submitted
        + 0.15 * (df.sleep_hours - 7)
        + 0.3 * (df.parent_education != "School")
    )
    prob = 1 / (1 + np.exp(-logit))
    return np.where(rng.random(len(df)) < prob, "Pass", "Fail")


student_train = students(1800)
student_train["result"] = student_results(student_train)
student_train.to_csv(OUT / "student_performance_train.csv", index=False)

# Batch 1: an ordinary semester -> no drift.
students(450).to_csv(OUT / "student_batch1_normal_semester.csv", index=False)

# Batch 2: the semester moved online -> new "Online" class mode, lower attendance,
# less study time and fewer assignments handed in.
students(
    450,
    modes=("Offline", "Hybrid", "Online"),
    mode_p=(0.15, 0.25, 0.60),
    attendance_shift=-18,
    study_scale=0.7,
    assignments_shift=-2,
).to_csv(OUT / "student_batch2_online_semester.csv", index=False)

for f in sorted(OUT.glob("*.csv")):
    rows = sum(1 for _ in f.open()) - 1
    print(f"{f.name:34s} {rows:5d} rows")
