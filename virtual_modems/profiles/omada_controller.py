from __future__ import annotations

from ..shared.omada_controller_mock import OmadaControllerMock


def create_app():
    return OmadaControllerMock().create_app(
        "Virtual TP-Link Omada Controller (ha-omada + tplink_omada)"
    )


app = create_app()
