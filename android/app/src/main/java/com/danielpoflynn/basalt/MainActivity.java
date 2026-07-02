package com.danielpoflynn.basalt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BasaltGitPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
