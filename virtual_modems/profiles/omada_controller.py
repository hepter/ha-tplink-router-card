from __future__ import annotations

from ..shared.omada_controller_mock import OmadaControllerMock


def create_app():
    mock = OmadaControllerMock()
    return mock.create_app(
        f"Virtual TP-Link Omada Controller {mock.version} (ha-omada + tplink_omada)"
    )


app = create_app()
