"""The topic engine: it asks a model for the topics of one lesson through Cognee."""

from rubber_duck_engine.settings import pin_cognee_environment

# Each module of this package can import Cognee. Cognee reads its env file and its log settings at import,
# so the package pins them first.
pin_cognee_environment()
