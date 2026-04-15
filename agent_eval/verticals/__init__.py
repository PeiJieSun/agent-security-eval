"""Built-in vertical packs — auto-register on import."""
from agent_eval.vertical_pack import VerticalPackRegistry
from agent_eval.verticals.power_grid import POWER_GRID_PACK
from agent_eval.verticals.finance import FINANCE_PACK
from agent_eval.verticals.nuclear import NUCLEAR_PACK
from agent_eval.verticals.healthcare import HEALTHCARE_PACK

_registry = VerticalPackRegistry.instance()
_registry.register(POWER_GRID_PACK)
_registry.register(FINANCE_PACK)
_registry.register(NUCLEAR_PACK)
_registry.register(HEALTHCARE_PACK)
