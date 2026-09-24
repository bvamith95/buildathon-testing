from landfall_pipeline.store.schema import BucketSignature


def test_bucket_signature_is_stable_and_order_independent_of_construction():
    a = BucketSignature(
        entry_document="eta",
        biometrics="exempt",
        medical_exam="not_required",
        funds_evidence="standard",
        currency_corridor="major",
    )
    b = BucketSignature(
        currency_corridor="major",
        funds_evidence="standard",
        medical_exam="not_required",
        biometrics="exempt",
        entry_document="eta",
    )
    assert a.signature() == b.signature()
    assert a.signature() == "eta-exempt-not_required-standard-major"
